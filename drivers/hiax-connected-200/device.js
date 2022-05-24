'use strict';

const { privateEncrypt } = require('crypto');
const { OAuth2Device } = require('homey-oauth2app');
const retryOnErrorWaitTime = 10000 // ms


// Mapping between settings and controller keys
const key_map = {
  ambient_temperature:  "100",
  inlet_temperature:    "101",
  max_water_flow:       "512",
  regulation_diff:      "516",
  legionella_frequency: "511",
  controling_device:    "500",
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
    //    Value 0 = Off, 1 = 700W, 2 = 1300W, 3 = 2000W
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
    let new_power_text = (new_power == 1) ? "low_power" : (new_power == 2) ? "medium_power" : "high_power"
    let new_power_watt = (new_power == 1) ?         700 : (new_power == 2) ? 1300           : 2000
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



  /**
   * Override the setSettings function to make sure the settings are of right type
   */
  async setSettings(new_settings) {
    let to_settings = clone(new_settings)

    to_settings.controling_device = String(to_settings.controling_device)
    to_settings.TankVolume        = String(to_settings.TankVolume)
    to_settings.SerialNo          = String(to_settings.SerialNo) // Also in this.getData().deviceId
    to_settings.HeaterNomPower    = String(to_settings.HeaterNomPower)
    to_settings.HeaterNomPower2   = String(to_settings.HeaterNomPower2)
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

    // Make sure that the Heater mode is controllable - set to External mode
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
          if (state_request[val].writable == false) {
            internal_states[reverse_key_map[state_request[val].parameterId]] = state_request[val].strVal; // Value with unit
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
      await this.setSettings(internal_states);
    }
    catch(err) {
      // This should never happen so nothing to handle here, throw error instead
      throw new Error("setSettings failed, report to developer. This need to be fixed: " + err)
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

    // Register on/off handling
    this.registerCapabilityListener('onoff', async (turn_on) => {
      await this.setHeaterState(this.deviceId, turn_on, this.max_power)
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
    //this.setCapabilityValue('measure_humidity.efficiency', dev_points[4].value) //405 = HeaterEfficiency
    if ("value" in dev_points[0]) { // 302 = EnergyStored
      this.setCapabilityValue('meter_power.in_tank', dev_points[0].value)
    }
    if ("value" in dev_points[1]) { // 303 = EnergyTotal
      this.setCapabilityValue('meter_power.accumulated', dev_points[1].value)
    }
    if ("value" in dev_points[2]) { // 400 = EstimatedPower
      this.setCapabilityValue('measure_power', dev_points[2].value)
    }
    if ("value" in dev_points[3]) { //404 = FillLevel
      this.setCapabilityValue('measure_humidity.fill_level', dev_points[3].value)
    }
    if ("value" in dev_points[4]) { // 517 = Requested power
      let current_max_power = dev_points[4].value
      // Value 0 = Off, 1 = 700W, 2 = 1300W, 3 = 2000W
      if (current_max_power == 0) {
        // Heater is off
        this.is_on     = false
      } else {
        this.is_on     = true
        this.max_power = current_max_power
      }
      this.setHeaterState(deviceId, this.is_on, this.max_power)
    }
    if ("value" in dev_points[5]) { // 527 = Requested temperature
      this.setCapabilityValue('target_temperature', dev_points[5].value)
    }
    if ("value" in dev_points[6]) { // 528 = Measured temperature
      this.setCapabilityValue('measure_temperature', dev_points[6].value)
    }
    this.setAvailable() // In case it was set to unavailable
  }

  async onOAuth2Deleted() {
    // Clean up here
    this.log('MyHoiaxDevice was deleted');
  }

}

module.exports = MyHoiaxDevice;
