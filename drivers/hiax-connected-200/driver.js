/* eslint-disable comma-dangle */

'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class HoiaxDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onOAuth2Init() {
    // Register Flow Cards etc.
    this._maxPowerChangedTrigger = this.homey.flow.getDeviceTriggerCard('maxpower-changed');
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
    const devicelist = [];
    // Fetch only the first page as nobody will ever control more than 10 water tanks with Homey
    const things = await oAuth2Client.getDevices({ page: 1 });

    // NOTE: This code has Never been tested with more than 1 device but should support more
    for (let itemNr = 0; itemNr < things.numItems; itemNr++) {
      const system = things.systems[itemNr];
      for (let deviceNr = 0; deviceNr < system.devices.length; deviceNr++) {
        const device = system.devices[deviceNr];
        const mydevice = {
          name: undefined, // Replaced by product name
          data: {
            systemId: system.systemId,
            systemName: system.name,
            deviceId: device.id,
            deviceSerial: device.product.serialNumber,
            deviceName: device.product.name
          }
        };
        devicelist.push(mydevice);
      }
    }
    return devicelist;
  }

}

module.exports = HoiaxDriver;
