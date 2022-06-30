'use strict';

const { privateEncrypt } = require('crypto');
const { OAuth2Device } = require('homey-oauth2app');
const retryOnErrorWaitTime = 10000; // ms

// Connected 200 constants
const CONNECTED_200_PROPERTIES = {
  size: 187,
  element1_power: 700,
  element2_power: 1300,
  leakage_constant: 1.58
}

// Connected 300 constants
const CONNECTED_300_PROPERTIES = {
  size: 283,
  element1_power: 1250,
  element2_power: 1750,
  leakage_constant: undefined
}

// Mapping between settings and controller keys
const key_map = {
  ambient_temperature:  "100",
  inlet_temperature:    "101",
  max_water_flow:       "512",
  regulation_diff:      "516",
  legionella_frequency: "511",
  controling_device:    "500",
  nordpool_price_region:"544",
  num_expensive_hours:  "545",
  min_remain_heat:      "546",
  num_cheap_hours:      "547",
  temp_inc_cheap_hours: "548",
  TankVolume:           "526",
  SerialNo:             "518",
  HeaterNomPower:       "503",
  HeaterNomPower2:      "504"
}


// Clones an associative array
function clone(obj) {
  if (null == obj || "object" != typeof obj) return obj;
  var copy = obj.constructor();
  for (var attr in obj) {
      if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
  }
  return copy;
}

// Wait for a few millisecconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class MyHoiaxDevice extends OAuth2Device {

  async setHeaterState(deviceId, turn_on, new_power) {
    // 1) Send commands to device
    //    Value 0 = Off, 1 = this.HeaterNomPower, 2 = this.HeaterNomPower2, 3 = this.HeaterNomPower+this.HeaterNomPower2
    let power = turn_on ? new_power : 0
    let onoff_response = undefined
    while (onoff_response == undefined || onoff_response.ok == false) {
      try {
        onoff_response = await this.oAuth2Client.setDevicePoint(deviceId, { '517': power });
      }
      catch(err) {
        this.setUnavailable("Network problem: " + err)
        await sleep(retryOnErrorWaitTime)
      }
    }
    this.setAvailable() // In case it was set to unavailable

    // 2) Set capability states
    let new_power_text = (new_power == 1) ? "low_power"         : (new_power == 2) ? "medium_power"       : "high_power"
    let new_power_watt = (new_power == 1) ? this.HeaterNomPower : (new_power == 2) ? this.HeaterNomPower2 : (this.HeaterNomPower + this.HeaterNomPower2)
    this.setCapabilityValue('onoff', turn_on).catch(this.error)
    this.setCapabilityValue('max_power', new_power_text).catch(this.error)

    // 3) Send trigger action
    if (new_power != this.max_power) {
      const tokens = { 'max_power': new_power_watt };
      this.driver.ready().then(() => {
        this.driver.triggerMaxPowerChanged(this, tokens, {})
      })
    }
    // 4) Set internal state
    this.is_on = turn_on
    this.max_power = new_power
  }

  async setAmbientTemp(deviceId, ambient_temp) {
    if (isNaN(ambient_temp)) {
      return;
    }
    //this.log("New ambient temperature:" + String(ambient_temp))
    this.setSettings({ "ambient_temperature": ambient_temp })
    this.outsideTemp = ambient_temp;
    let key_change = {}
    key_change[key_map['ambient_temperature']] = this.outsideTemp;
    let response = undefined
    while (response == undefined || response.ok == false) {
      try {
        response = await this.oAuth2Client.setDevicePoint(deviceId, key_change);
      }
      catch(err) {
        this.setUnavailable("Network problem: " + err)
        await sleep(retryOnErrorWaitTime)
      }
    }
    this.setAvailable() // In case it was set to unavailable
  }



  /**
   * Override the setSettings function to make sure the settings are of right type
   */
  async toSettings(new_settings) {
    let to_settings = clone(new_settings)
    to_settings.nordpool_price_region = String(to_settings.nordpool_price_region)
    to_settings.num_expensive_hours = to_settings.num_expensive_hours
    to_settings.min_remain_heat   = to_settings.min_remain_heat
    to_settings.num_cheap_hours   = to_settings.num_cheap_hours
    to_settings.temp_inc_cheap_hours = to_settings.temp_inc_cheap_hours
    to_settings.controling_device = String(to_settings.controling_device)
    to_settings.TankVolume        = String(to_settings.TankVolume)
    to_settings.SerialNo          = String(to_settings.SerialNo) // Also in this.getData().deviceId
    to_settings.HeaterNomPower    = String(to_settings.HeaterNomPower)
    to_settings.HeaterNomPower2   = String(to_settings.HeaterNomPower2)
    to_settings.LeakageConstant   = String(this.leakageConstant) + " W/Δ°C"
    to_settings.systemId          = String(this.getData().systemId)
    to_settings.systemName        = String(this.getData().systemName)
    to_settings.deviceId          = String(this.getData().deviceId)
    to_settings.deviceName        = String(this.getData().deviceName)
    return await super.setSettings(to_settings)
  }


  /**
   * onOAuth2Init is called when the device is initialized.
   */
  async onOAuth2Init() {
    this.log('MyHoiaxDevice was initialized');
    this.setUnavailable("Initializing device.")
    this.deviceId = this.getData().deviceId
    this.intervalID = undefined

    // Capability update from version 1.3.3
    if (!this.hasCapability("meter_power.leak_accum")) {
      await this.addCapability("meter_power.leak_accum");
    }
    if (!this.hasCapability("measure_power.leak")) {
      await this.addCapability("measure_power.leak");
    }
    if (!this.hasCapability("measure_humidity.leak_relation")) {
      await this.addCapability("measure_humidity.leak_relation");
    }

    // Initial state for leakage heat
/*    this.prevPower = undefined;
    this.prevTemp  = undefined;
    this.prevStored= undefined;
    this.prevTime  = undefined;
    this.pastLeakage = [];*/
    this.prevRelationTime = undefined;
    this.prevRelationUse  = undefined;
    this.prevRelationLeak = undefined;
    this.prevAccumTime = this.getStoreValue("prevAccumTime");
    this.leakageConstant = this.getStoreValue("leakageConstant");
    this.accumulatedLeakage = this.getStoreValue("accumulatedLeakage");
    if (this.prevAccumTime == undefined) this.prevAccumTime = new Date();
    if (this.leakageConstant == undefined) this.leakageConstant = 1.58;
    if (this.accumulatedLeakage == undefined) this.accumulatedLeakage = 0;
    const device_properties = CONNECTED_200_PROPERTIES;
    this.leakageConstant = device_properties.leakage_constant; // Set it static here because those running debug versions have incorrect leakage
    if (this.leakageConstant == undefined) {
      // In case the leakage constant has not been measured for a device, just scale a known one to have something until
      // it is more accurate
      this.leakageConstant = CONNECTED_200_PROPERTIES.leakage_constant * device_properties.size / CONNECTED_200_PROPERTIES.size;
    }

    // Defaults for values fetched from myUplink in case myUplink is unavailable
    this.outsideTemp     =   24; // Updated by a flow if set up
    this.tankVolume      = device_properties.size;
    this.HeaterNomPower  = device_properties.element1_power;
    this.HeaterNomPower2 = device_properties.element2_power;

    // === Debug code to show if new features has been added ===
    // let all_features = await this.oAuth2Client.getDevicePoints(this.deviceId);
    // this.log(JSON.stringify(all_features))

    // Make sure that the Heater mode is controllable - set to External mode (but only if first time the app is run)
    this.isFirstTime = this.getStoreValue("isFirstTime")
    if (this.isFirstTime == undefined) {
      let heater_mode = undefined
      while (heater_mode == undefined) {
        try {
          heater_mode = await this.oAuth2Client.getDevicePoints(this.deviceId, '500');
        } catch(err) {
          heater_mode = undefined
          this.setUnavailable("Network problem: " + err)
          await sleep(retryOnErrorWaitTime)
        }
      }
      if (heater_mode[0] == undefined) {
        // Given the while loop above this should not happen so throw error
        throw new Error('Problems reading heater mode: ' + heater_mode.message);
      } else if (heater_mode[0].value != 8) { // 8 == External
        let res = undefined
        while (res == undefined || res.ok == false) {
          try {
            res = await this.oAuth2Client.setDevicePoint(this.deviceId, { '500': '8' });
          }
          catch(err) {
            this.setUnavailable("Network problem: " + err)
            await sleep(retryOnErrorWaitTime)
          }
        }
      }
      this.isFirstTime = false
      this.setStoreValue("isFirstTime", this.isFirstTime).catch(this.error);
    }

    // Set heater max power to 2000 W
    this.max_power = 3
    this.is_on = true

    // Update internal setup state once only
    let state_to_fetch = Object.values(key_map).join(",")
    var state_request = undefined
    while (state_request == undefined) {
      try {
        state_request = await this.oAuth2Client.getDevicePoints(this.deviceId, state_to_fetch);
      } catch(err) {
        this.setUnavailable("Network problem: " + err)
        await sleep(retryOnErrorWaitTime)
      }
    }

    var reverse_key_map = {}
    let keys = Object.keys(key_map)
    for (let key_nr = 0; key_nr < keys.length; key_nr++) {
      reverse_key_map[key_map[keys[key_nr]]] = keys[key_nr]
    }
    var internal_states = {}
    if (Array.isArray(state_request)) {
      for (var val = 0; val < state_request.length; val++) {
        if ('parameterId' in state_request[val]) {
          if (state_request[val].writable === false) {
            internal_states[reverse_key_map[state_request[val].parameterId]] = state_request[val].strVal; // Value with unit
            let value  = parseInt(state_request[val].value);
            // This is only required for unknown Høiax devices as these should match with the defaults for all defined devices
            switch (state_request[val].parameterId) {
              case 100: this.outsideTemp     = value; break;
              case 503: this.HeaterNomPower  = value; break;
              case 504: this.HeaterNomPower2 = value; break;
              case 526: this.tankVolume      = value; break;
            }
          } else {
            internal_states[reverse_key_map[state_request[val].parameterId]] = state_request[val].value; // Value without unit
          }
        }
      }
    }

    if (Object.keys(internal_states).length != Object.keys(key_map).length) {
      // This should not happen due to the while loop above
      var debug_txt = JSON.stringify(state_request).substring(0,300)
      throw new Error("Unable to initialize driver - device state could not be read - try restarting the app. (for debug: " + debug_txt)
    }

    try {
      await this.toSettings(internal_states);
    }
    catch(err) {
      // This should never happen so nothing to handle here, throw error instead
      throw new Error("toSettings failed, report to developer. This need to be fixed: " + err)
    }

    // Update internal state every 5 minute:
    await this.updateState(this.deviceId)
    this.intervalID = setInterval(() => {
      this.updateState(this.deviceId)
    }, 1000*60*5)

    // Custom flows
    const OnMaxPowerAction  = this.homey.flow.getActionCard('change-maxpower')

    OnMaxPowerAction.registerRunListener(async (state) => {
      await this.setHeaterState(
        this.deviceId,
        this.is_on,
        (state['max_power'] == "low_power") ? 1 :
        (state['max_power'] == "medium_power") ? 2 : 3 )
    })

    const OnAmbientAction  = this.homey.flow.getActionCard('change-ambient-temp')

    OnAmbientAction.registerRunListener(async (state) => {
      await this.setAmbientTemp(this.deviceId, state['ambient_temp'])
    })

    // Register on/off handling
    this.registerCapabilityListener('onoff', async (turn_on) => {
      await this.setHeaterState(this.deviceId, turn_on, this.max_power)
    })
    // Register ambient temperature handling (probably not required as the capability is hidden)
    this.registerCapabilityListener('ambient_temp', async (ambient_temp) => {
      await this.setAmbientTemp(this.deviceId, ambient_temp)
    })
    // Register max power handling
    this.registerCapabilityListener('max_power', async (value) => {
      let new_power = 3 // High power
      if (value == 'low_power') {
        new_power = 1
      } else if (value == 'medium_power') {
        new_power = 2
      }
      await this.setHeaterState(this.deviceId, this.is_on, new_power)
    })

    // Register target temperature handling
    this.registerCapabilityListener('target_temperature', async (value) => {
      let target_temp = undefined
      while (target_temp == undefined || target_temp.ok == false) {
        try {
          target_temp = await this.oAuth2Client.setDevicePoint(this.deviceId, { '527': value });
        }
        catch(err) {
          this.setUnavailable("Network problem: " + err)
          await sleep(retryOnErrorWaitTime)
        }
      }
      this.setAvailable()
      this.log('Target temp:', value)
    })
    this.setAvailable()
  }

  //
  async onOAuth2Deleted() {
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown device.
    if (this.intervalID != undefined) {
      clearInterval(this.intervalID)
    }
  }


  // Calculate leakage heat and update the stores
  // Leakage is calculated from a series of measurements where the following are ignored:
  // * There was power usage since last time or
  // * The temperature increased in the tank
  // * The largest 50% of the entries are ignored as possibly being affected by tapped water
  //   (tank experience higher temperature fluctuations up to 20 minutes after water being tapped)
  // * The lowest 25% of the entries are ignored as possibly being affected by previous cycle heating
  // From the remaining 25% the leakage is calculated as an average.
  // A good description of leakage heat is here:
  // https://vannbaserte.nemitek.no/833-artikkel-vannbaserte-oppvarmings-og-kjolesystemer-2014/beredertemperatur-og-varmetap/163668
  async logLeakage(total_usage, temperature, in_tank, debug_time = undefined) {
    this.log("logLeakage(" + String(total_usage) + ", " + String(temperature) + ", " + String(in_tank) + ", " + String((new Date()).getTime()) + ");");
    let new_time = isNaN(debug_time) ? new Date() : debug_time;
    // Make sure input is valid
    if (isNaN(total_usage) || isNaN(temperature) || isNaN(in_tank)) {
        throw("Invalid values read from water heater");
    }
/*    let LOGITEMS = 200; // Maximum logged items (higher number improves estimation, 12=one hour)
    // If first time set state and exit
    if (this.prevPower == undefined || this.prevTemp == undefined || this.prevStored == undefined) {
      this.prevPower  = total_usage;
      this.prevTemp   = temperature;
      this.prevStored = in_tank;
      this.prevTime   = new_time;
      return
    }
    // Calculate diff from last time
    var powDiff   = total_usage - this.prevPower;
    var tempDiff  = temperature - this.prevTemp;
    var storeDiff = in_tank     - this.prevStored; // diff in kWh
    var timeDiff  = new_time    - this.prevTime;   // diff in ms
*/    var outerTempDiff = temperature - this.outsideTemp;
/*    this.prevPower = total_usage;
    this.prevTemp  = temperature;
    this.prevStored= in_tank;
    this.prevTime  = new_time;
    let prevData = {
      powDiff: powDiff.toFixed(1),
      tempDiff: tempDiff.toFixed(1),
      timeDiff: timeDiff,
      storeDiff: storeDiff.toFixed(2),
      outerTempDiff: outerTempDiff.toFixed(1)
    };
    for (let idx = LOGITEMS-1; idx > 0; idx--) {
      if (this.pastLeakage[idx-1] != undefined)
        this.pastLeakage[idx] = this.pastLeakage[idx-1];
    }
    this.pastLeakage[0] = prevData;

    // Heat can only be measured with a single decimal point, so in order to find the leakage temperature
    // the following assumptions are made:
    // *) Average leakage will lie between the two most common temp diffs and averaging those
    // *) It is random when tank is being heated disregarding intervals with heating will not add a bias
    // *) It is random when water is being tapped so including it in the intervals will not affect the
    //    two most used intervals unless water is tapped by excessive ammounts.
    // *) If there is a constant leakage it will move the intervals so it will show as a heat leakage,
    //    which is ok.

    // Find temp-diff normal distribution:
    let temp_diffs = {};
    let include_count = 0;
    for (let idx = 0; idx < this.pastLeakage.length; idx++) {
      if ((this.pastLeakage[idx].powDiff == 0) && (this.pastLeakage[idx].tempDiff <= 0)) {
        include_count++;
        if (this.pastLeakage[idx].tempDiff in temp_diffs) {
          temp_diffs[this.pastLeakage[idx].tempDiff]++;
        } else {
          temp_diffs[this.pastLeakage[idx].tempDiff] = 1;
        }
      }
    }

    var keys = Object.keys(temp_diffs);
    var sortedKeys = keys.sort(function(a,b){return temp_diffs[b]-temp_diffs[a]});
    // sortedKeys[0] should always be included, but sortedKeys[1] may not be if it is not next to it,
    var key0 = sortedKeys[0];
    var key1 = undefined;
    if (include_count == 0 || temp_diffs[sortedKeys[0]] < 10) {
      // Do not continue before sufficient data has been logged
      this.log("Too few entries recorded, fall back on old calculations");
      key0 = undefined;
    } else if ((sortedKeys.length>1) && (Math.abs(parseInt(sortedKeys[1]*10) - parseInt(sortedKeys[0]*10)) != 1)) { // Key0 and key1 are not neighbours
      if (temp_diffs[sortedKeys[0]] < 3 * temp_diffs[sortedKeys[1]]) {
        // If  key 1 is not next to key 0 and there is a small difference then the signal to noise ratio is too big.
        // Too noisy
        this.log("Too noisy to use the data, fall back on old calculations");
        key0 = undefined;
      }
    } else {
      // Find second key to use
      var key1a = parseFloat(key0) - 0.1;
      var key1b = parseFloat(key0) + 0.1;
      key1a = key1a.toFixed(1);
      key1b = key1b.toFixed(1);
      if (!(key1a in temp_diffs || key1b in temp_diffs)) {
        // Found neither side of key0, use key0 only
      } else if (!(key1a in temp_diffs)) {
        // Use key0 and key1b
        key1 = key1b;
      } else if (!(key1b in temp_diffs)) {
        // Use key0 and key1a
        key1 = key1a;
      } else if (temp_diffs[key1a] >= temp_diffs[key1b]) {
        // Use key0 and key1a as it is used next most (or has smallest leakage if equal)
        if (temp_diffs[key1a] > 2 * temp_diffs[key1b]) {
          key1 = key1a;
        } else {
          this.log("Too much noise, falling back on old calculations")
          key0 = undefined;
        }
      } else {
        // Use key0 and key1b as it is used next most
        if (temp_diffs[key1b] > 2 * temp_diffs[key1a]) {
          key1 = key1b;
        } else {
          this.log("Too much noise, falling back on old calculations")
          key0 = undefined;
        }
      }
    }

    // Heat transfer from the tank is linear with the temperature difference:
    // loss = k * (T_tank - T_outside) * t
    //      k : a constant for the tank
    // The loss should be equivalent to (4.187 * temp_loss * tank_litres / 3600)

    // Calculate leakage from temperature drop over time:
    if (key0 == undefined) {
      // Otherwise, keep leakageConstant unchanged
      this.log("Using old leakage constant:" + String(this.leakageConstant))
    } else {
      // Go through entire log and calculate likely leaked temperature for the two selected keys only
      let temp_drop_count = temp_diffs[key0] + ((key1 == undefined) ? 0 : temp_diffs[key1]);
      let temp_drop_val   = 0;
      for (let idx = 0; idx < this.pastLeakage.length; idx++) {
        if ((this.pastLeakage[idx].tempDiff === key0) || (this.pastLeakage[idx].tempDiff === key1)) {
          temp_drop_val -= this.pastLeakage[idx].tempDiff * 1000000. / (this.pastLeakage[idx].outerTempDiff * this.pastLeakage[idx].timeDiff);
        }
      }

      // Smooth out changes to the leakage constant so it is less prone to errors
      let new_leakageConstant = (4.187 * temp_drop_val * this.tankVolume) / temp_drop_count;
      this.leakageConstant = (0.99 * this.leakageConstant) + (0.01 * new_leakageConstant);
      this.log("Leakage constant:" + String(this.leakageConstant) + " (new: " + String(new_leakageConstant) + ")")

      let changed_settings = { "LeakageConstant": String(this.leakageConstant) + " W/Δ°C" }
      this.log("---- changed settings:")
      this.log(changed_settings)
      this.setSettings(changed_settings)
    }
*/
    let accum_time_diff = new_time - this.prevAccumTime
    let currentLeakage = this.leakageConstant * outerTempDiff; // W
    let timedLeakage = currentLeakage * accum_time_diff / (60*60*1000000); // kWh
    if (!isNaN(timedLeakage)) {
      this.prevAccumTime = new_time;
      this.accumulatedLeakage += timedLeakage; 
      // Update statistics
      this.setCapabilityValue('measure_power.leak', currentLeakage);
      this.setCapabilityValue('meter_power.leak_accum', this.accumulatedLeakage);
      // Update stores
      this.setStoreValue("prevAccumTime", this.prevAccumTime).catch(this.error);
      //this.setStoreValue("leakageConstant", this.leakageConstant).catch(this.error);
      this.setStoreValue("accumulatedLeakage", this.accumulatedLeakage).catch(this.error);
    }

    // Check relations
    if (this.prevRelationTime == undefined) {
      this.prevRelationTime = new_time;
      this.prevRelationUse  = total_usage;
      this.prevRelationLeak = this.accumulatedLeakage;
    } else if ((new_time - this.prevRelationTime) > 24*60*60*1000) {
      // Once every day
      this.prevRelationTime = new_time;
      let leaked_energy = this.accumulatedLeakage - this.prevRelationLeak;
      let added_energy  = total_usage - this.prevRelationUse;
      this.prevRelationUse  = total_usage;
      this.prevRelationLeak = this.accumulatedLeakage;
      let leak_relation = (added_energy > leaked_energy) ? (100 * leaked_energy / added_energy) : 100;
      this.setCapabilityValue('measure_humidity.leak_relation', leak_relation);
      this.log("Relation: " + String(leaked_energy) + " " + String(added_energy) + "  " + String(leak_relation))
    } else {
      this.log("Time lapsed since last leak_check:" + String((new_time - this.prevRelationTime) / (1000*60*60)) + " hours")
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log("Settings changed")

    let key_change = {}
    for (var key_nr = 0; key_nr < changedKeys.length; key_nr++) {
      this.log(changedKeys[key_nr] + " changed: ", newSettings[changedKeys[key_nr]], " (key: ", key_map[changedKeys[key_nr]], ")")
      key_change[key_map[changedKeys[key_nr]]] = newSettings[changedKeys[key_nr]]
    }
    if (Object.keys(key_change).length > 0) {
      let response = undefined
      while (response == undefined || response.ok == false) {
        try {
          response = await this.oAuth2Client.setDevicePoint(this.deviceId, key_change);
        }
        catch(err) {
          this.setUnavailable("Network problem: " + err)
          await sleep(retryOnErrorWaitTime)
        }
      }
      this.setAvailable() // In case it was set to unavailable
    }
  }

  async updateState(deviceId) {
    let dev_points = undefined
    while (dev_points == undefined) {
      try {
        dev_points = await this.oAuth2Client.getDevicePoints(deviceId, '302,303,400,404,517,527,528');
      } catch(err) {
        this.setUnavailable("Network problem: " + err)
        await sleep(retryOnErrorWaitTime)
      }
    }
    let log_total, log_temp, log_stored;
    for (let loop = 0; loop < dev_points.length; loop++) {
      if ("parameterId" in dev_points[loop] && "value" in dev_points[loop]) {
        switch(parseInt(dev_points[loop].parameterId)) {
          case 405: // 405 = HeaterEfficiency (deprecated)
            //this.setCapabilityValue('measure_humidity.efficiency', dev_points[loop].value)
            break;
          case 302: // 302 = EnergyStored
            this.setCapabilityValue('meter_power.in_tank', dev_points[loop].value);
            log_stored = dev_points[loop].value;
            break;
          case 303: // 303 = EnergyTotal
            this.setCapabilityValue('meter_power.accumulated', dev_points[loop].value);
            log_total = dev_points[loop].value;
            break;
          case 400: // 400 = EstimatedPower
            this.setCapabilityValue('measure_power', dev_points[loop].value);
            break;
          case 404: //404 = FillLevel
            this.setCapabilityValue('measure_humidity.fill_level', dev_points[loop].value);
            break;
          case 517: // 517 = Requested power
            let current_max_power = dev_points[loop].value
            // Value 0 = Off, 1 = this.HeaterNomPower, 2 = this.HeaterNomPower2, 3 = this.HeaterNomPower+this.HeaterNomPower2
            if (current_max_power == 0) {
              // Heater is off
              this.is_on     = false
            } else {
              this.is_on     = true
              this.max_power = current_max_power
            }
            this.setHeaterState(deviceId, this.is_on, this.max_power);
            break;
          case 527: // 527 = Requested temperature
            this.setCapabilityValue('target_temperature', dev_points[loop].value);
            break;
          case 528: // 528 = Measured temperature
            this.setCapabilityValue('measure_temperature', dev_points[loop].value);
            log_temp = dev_points[loop].value;
            break;
          default:
            this.log("Device point parameterId " + String(dev_points[loop].parameterId) + " not handled")
            break;
        }
      } // Else parameterId not set.... this is only the case when internet connection is bad
    }
    this.logLeakage(log_total, log_temp, log_stored)
    this.setAvailable() // In case it was set to unavailable
  }

  async onOAuth2Deleted() {
    // Clean up here
    this.log('MyHoiaxDevice was deleted');
  }

}

module.exports = MyHoiaxDevice;
