'use strict';

const { privateEncrypt } = require('crypto');
const { OAuth2Device } = require('homey-oauth2app');

class MyHoiaxDevice extends OAuth2Device {

  /**
   * onOAuth2Init is called when the device is initialized.
   */
   async onOAuth2Init() {
    //await this.oAuth2Client.getThingState()
    //  .then(async state => {
    //    await this.setCapabilityValue('onoff', !!state.on);
    //  });
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
      

      // Register on/off handling
      this.registerCapabilityListener('onoff', async (value) => {
        // Value 0 = Off, 1 = 700W, 2 = 1300W, 3 = 2000W
        let power = value ? 3 : 0
        const onoff_response = await this.oAuth2Client.setDevicePoint(deviceId, { '517': power });
        if (onoff_response.ok === false) {
          throw new Error('Unable to Control device - Failed to power on/off');
        }
        this.log('Turned On/Off:', value)
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
    const dev_points = await this.oAuth2Client.getDevicePoints(deviceId, '400,517,527,528');
    this.setCapabilityValue('meter_power', dev_points[0].value) // 400 = EstimatedPower
    if (dev_points[1].value == 0) { // 517 = Requested power
      this.setCapabilityValue('onoff', false).catch(this.error)
    } else {
      this.setCapabilityValue('onoff', true).catch(this.error)
    }
    this.setCapabilityValue('target_temperature', dev_points[2].value) // 527 = Requested temperature
    this.setCapabilityValue('measure_temperature', dev_points[3].value) // 528 = Measured temperature
  }

  async onOAuth2Deleted() {
    // Clean up here
    this.log('MyHoiaxDevice was deleted');
  }

}

module.exports = MyHoiaxDevice;
