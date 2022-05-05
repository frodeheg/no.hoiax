'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class HoiaxDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onOAuth2Init() {
    // Register Flow Cards etc.
    this._maxPowerChangedTrigger = this.homey.flow.getDeviceTriggerCard('maxpower-changed')
    this.log('HoiaxOAuth2Driver has been initialized');
  }

  /**
   * triggerOnOffFlow triggers the flow to turn on/off the water heater partially
   */
   triggerMaxPowerChanged(device, tokens, state) {
    this._maxPowerChangedTrigger
    .trigger(device, tokens, state)
    .catch(this.error);
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    let devicelist = []
    // Fetch only the first page as nobody will ever control more than 10 water tanks with Homey
    const things = await oAuth2Client.getDevices({ page: 1 });

    if (things.numItems == 0) {
      throw new Error('No devices was found');
    }

    // NOTE: This code has Never been tested with more than 1 device but should support more
    for (let item_nr = 0; item_nr < things.numItems; item_nr++) {
      const system = things.systems[item_nr]
      for (let device_nr = 0; device_nr < system.devices.length; device_nr++) {
        const device = system.devices[device_nr]
        let mydevice = {
          name: undefined, // Replaced by product name
          data: {
            systemId:     system.systemId,
            systemName:   system.name,
            deviceId:     device.id,
            deviceSerial: device.product.serialNumber,
            deviceName:   device.product.name
          }
        }
        devicelist.push(mydevice)
      }
    }
    return devicelist
  }

}

module.exports = HoiaxDriver;
