'use strict';

const { privateEncrypt } = require('crypto');
const { OAuth2Device } = require('homey-oauth2app');


// Mapping between settings and controller keys
const key_map = {
  ambient_temperature:  "100",
  inlet_temperature:    "101",
  max_water_flow:       "512",
  regulation_diff:      "516",
  legionella_frequency: "511",
  controling_device:    "500"
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

class MyHoiaxDevice extends OAuth2Device {

  async setHeaterState(deviceId, turn_on, new_power) {
    // 1) Send commands to device
    //    Value 0 = Off, 1 = 700W, 2 = 1300W, 3 = 2000W
    let power = turn_on ? new_power : 0
    const onoff_response = await this.oAuth2Client.setDevicePoint(deviceId, { '517': power });
    if (onoff_response.ok === false) {
      throw new Error('Unable to Control device - Failed to power on/off');
    }
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
   * onOAuth2Init is called when the device is initialized.
   */
  async onOAuth2Init() {
    this.log('MyHoiaxDevice was initialized');
    this.deviceId = this.getData().deviceId

    try {
      // Make sure that the Heater mode is controllable - set to External mode
      const heater_mode = await this.oAuth2Client.getDevicePoints(this.deviceId, '500');
      if (heater_mode[0] == undefined) {
        throw new Error('Problems reading heater mode: ' + heater_mode.message);
      } else if (heater_mode[0].value != 8) { // 8 == External
        let res = undefined
        try {
          res = await this.oAuth2Client.setDevicePoint(this.deviceId, { '500': '8' });
        }
        catch(err) {
          if (res == undefined || res.ok === false) {
            throw new Error('Unable to Control device - Failed to put it into External mode');
          }
        }
      }

      // Set heater max power to 2000 W
      this.max_power = 3
      this.is_on = true

      // Update internal setup state once only
      var state_request = await this.oAuth2Client.getDevicePoints(this.deviceId, '100,101,500,511,512,516');
      var reverse_key_map = {}
      let keys = Object.keys(key_map)
      for (let key_nr = 0; key_nr < keys.length; key_nr++) {
        reverse_key_map[key_map[keys[key_nr]]] = keys[key_nr]
      }
      var internal_states = {}
      if (Array.isArray(state_request)) {
        for (var val = 0; val < state_request.length; val++) {
          if ('parameterId' in state_request[val] && 'value' in state_request[val]) {
            internal_states[reverse_key_map[state_request[val].parameterId]] = state_request[val].value;
          }
        }
      }

      if (Object.keys(internal_states).length != 6) {
        var debug_txt = JSON.stringify(state_request).substring(0,300)
        throw new Error("Unable to initialize driver - device state could not be read - try restarting the app. (for debug: " + debug_txt)
      }

      // setSettings does not support type dropdown currently (Athom bug)
      // See https://community.homey.app/t/setsettings-does-not-work-for-all-types-of-settings/63614 for details
      // Thus we need to remove all dropdown types before calling the function
      // TODO: replace this code when Athom has fixed their bug
      let to_settings = clone(internal_states)
      delete(to_settings.controling_device)
      await this.setSettings(to_settings);

      // Update internal state every 5 minute:
      await this.updateState(this.deviceId)
      setInterval(() => {
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
        const target_temp = await this.oAuth2Client.setDevicePoint(this.deviceId, { '527': value });
        if (target_temp.ok === false) {
          throw new Error('Unable to Control device - Failed to set target temperature');
        }
        this.log('Target temp:', value)
      })
    } catch {
      this.setUnavailable("Could not initialize the device properly. This is most likely related to authentication issues. Please press the repair button to enter username/password again or restart the app. If it is still not working contact the developer through the forum.")
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
      const response = await this.oAuth2Client.setDevicePoint(this.deviceId, key_change);
      if (response.ok === false) {
        throw new Error('Unable to Control device - Failed to set ' + JSON.stringify(changedKeys));
      }
    }
  }

  async updateState(deviceId) {
    const dev_points = await this.oAuth2Client.getDevicePoints(deviceId, '302,303,400,404,517,527,528');
    this.setCapabilityValue('meter_power.in_tank', dev_points[0].value) // 302 = EnergyStored
    this.setCapabilityValue('meter_power.accumulated', dev_points[1].value) // 303 = EnergyTotal
    this.setCapabilityValue('measure_power', dev_points[2].value) // 400 = EstimatedPower
    this.setCapabilityValue('measure_humidity.fill_level', dev_points[3].value) //404 = FillLevel
    //this.setCapabilityValue('measure_humidity.efficiency', dev_points[4].value) //405 = HeaterEfficiency
    let current_max_power = dev_points[4].value // 517 = Requested power
    // Value 0 = Off, 1 = 700W, 2 = 1300W, 3 = 2000W
    if (current_max_power == 0) {
      // Heater is off
      this.is_on     = false
    } else {
      this.is_on     = true
      this.max_power = current_max_power
    }
    this.setHeaterState(deviceId, this.is_on, this.max_power)
    this.setCapabilityValue('target_temperature', dev_points[5].value) // 527 = Requested temperature
    this.setCapabilityValue('measure_temperature', dev_points[6].value) // 528 = Measured temperature
  }

  async onOAuth2Deleted() {
    // Clean up here
    this.log('MyHoiaxDevice was deleted');
  }

}

module.exports = MyHoiaxDevice;
