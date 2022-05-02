'use strict';

const { privateEncrypt } = require('crypto');
const { OAuth2Device } = require('homey-oauth2app');

class MyHoiaxDevice extends OAuth2Device {

  async setHeaterState(deviceId) {
    // Value 0 = Off, 1 = 700W, 2 = 1300W, 3 = 2000W
    let power = (this.upperState ? 1 : 0) + (this.lowerState ? 2 : 0)
    const onoff_response = await this.oAuth2Client.setDevicePoint(deviceId, { '517': power });
    if (onoff_response.ok === false) {
      throw new Error('Unable to Control device - Failed to power on/off');
    }
    this.log('Turned On/Off:', power)
  }

  /**
   * onOAuth2Init is called when the device is initialized.
   */
   async onOAuth2Init() {
      this.log('MyHoiaxDevice was initialized');

      let all_sym = Object.getOwnPropertySymbols(this)
      // This is probably the worst way ever to extract the information but
      // my JavaScript skills are too bad to extract it in an elegant way
      let data = undefined
      for (let i = 0; i < all_sym.length; i++) {
        if (all_sym[i].toString() == "Symbol(data)") {
          data = all_sym[i]
        }
      }
      let deviceId = this[data].deviceId

      // Make sure that the Heater mode is controllable - set to External mode
      const heater_mode = await this.oAuth2Client.getDevicePoints(deviceId, '500');
      if (heater_mode[0].value != 8) { // 8 == External
        let res = undefined
        try {
          res = await this.oAuth2Client.setDevicePoint(deviceId, { '500': '8' });
        }
        catch(err) {
          if (res == undefined || res.ok === false) {
            throw new Error('Unable to Control device - Failed to put it into External mode');
          }
        }
      }

      // Check if the device Status and update internal state every now and then:
      await this.updateState(deviceId)
      setInterval(() => {
        this.updateState(deviceId)
      }, 1000*60*5) // Every 5 minute
      

      const OnOffTrigger = this.homey.flow.getTriggerCard('the-water-heater-turned-onoff')
      const OnOffAction  = this.homey.flow.getActionCard('turn-water-heater-onoff')

      OnOffAction.registerRunListener(async (state) => {
        this.upperState = (state['upper'] == "true")
        this.lowerState = (state['lower'] == "true")
        await this.setHeaterState(deviceId)
      })

      // Register on/off handling
      this.registerMultipleCapabilityListener(['onoff.upper', 'onoff.lower'], async (value) => {
        if (value['onoff.upper'] != undefined) { this.upperState = value['onoff.upper'] }
        if (value['onoff.lower'] != undefined) { this.lowerState = value['onoff.lower'] }
        const tokens = {
          'upper-on': this.upperState,
          'lower-on': this.lowerState
        };
        OnOffTrigger.trigger(tokens)
          .catch(this.error);
          await this.setHeaterState(deviceId)
      })

      // Register target temperature handling
      this.registerCapabilityListener('target_temperature', async (value) => {
        const target_temp = await this.oAuth2Client.setDevicePoint(deviceId, { '527': value });
        if (target_temp.ok === false) {
          throw new Error('Unable to Control device - Failed to set target temperature');
        }
        this.log('Target temp:', value)
      })
    }

  async updateState(deviceId) {
    const dev_points = await this.oAuth2Client.getDevicePoints(deviceId, '302,303,400,404,405,517,527,528');
    this.setCapabilityValue('meter_power.in_tank', dev_points[0].value) // 302 = EnergyStored
    this.setCapabilityValue('meter_power.accumulated', dev_points[1].value) // 303 = EnergyTotal
    this.setCapabilityValue('measure_power', dev_points[2].value) // 400 = EstimatedPower
    this.setCapabilityValue('measure_humidity.fill_level', dev_points[3].value) //404 = FillLevel
    this.setCapabilityValue('measure_humidity.efficiency', dev_points[4].value) //405 = HeaterEfficiency
    this.upperState = (dev_points[5].value & 1) == 1 // 517 = Requested power
    this.lowerState = (dev_points[5].value & 2) == 2 // 517 = Requested power
    this.setCapabilityValue('onoff.upper', this.upperState).catch(this.error)
    this.setCapabilityValue('onoff.lower', this.lowerState).catch(this.error)
    this.setCapabilityValue('target_temperature', dev_points[6].value) // 527 = Requested temperature
    this.setCapabilityValue('measure_temperature', dev_points[7].value) // 528 = Measured temperature
  }

  async onOAuth2Deleted() {
    // Clean up here
    this.log('MyHoiaxDevice was deleted');
  }

}

module.exports = MyHoiaxDevice;
