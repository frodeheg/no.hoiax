/* eslint-disable no-restricted-syntax */
/* eslint-disable comma-dangle */
/* eslint-disable no-nested-ternary */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');

const retryOnErrorWaitTime = 10000; // ms
const retryOnOkWaitTime = 5000; // ms

// Device types
const DEVICE_TYPE_CONNECTED_200 = 1;
const DEVICE_TYPE_CONNECTED_300 = 2;
const DEVICE_TYPE_UNKNOWN = undefined;

// Connected 200 constants
const CONNECTED_200_PROPERTIES = {
  size: 187,
  element1_power: 700,
  element2_power: 1300,
  leakage_constant: 1.58
};

// Connected 300 constants
const CONNECTED_300_PROPERTIES = {
  size: 283,
  element1_power: 1250,
  element2_power: 1750,
  leakage_constant: undefined
};

// Mapping between settings and controller keys
const keyMap = {
  ambient_temperature: '100',
  inlet_temperature: '101',
  max_water_flow: '512',
  regulation_diff: '516',
  legionella_frequency: '511',
  controling_device: '500',
  nordpool_price_region: '544',
  num_expensive_hours: '545',
  min_remain_heat: '546',
  num_cheap_hours: '547',
  temp_inc_cheap_hours: '548',
  TankVolume: '526',
  SerialNo: '518',
  HeaterNomPower: '503',
  HeaterNomPower2: '504'
};

// Clones an associative array
function clone(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  const copy = obj.constructor();
  for (const attr in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, attr)) copy[attr] = clone(obj[attr]);
  }
  return copy;
}

// Wait for a few millisecconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class MyHoiaxDevice extends OAuth2Device {

  async setHeaterState(deviceId, turnOn, newPower) {
    // 1) Send commands to device
    //    Value 0 = Off, 1 = this.HeaterNomPower, 2 = this.HeaterNomPower2, 3 = this.HeaterNomPower+this.HeaterNomPower2
    const power = turnOn ? newPower : 0;
    return this.oAuth2Client.setDevicePoint(deviceId, { 517: power })
      .then(onoffResponse => {
        if (onoffResponse) {
          this.setAvailable(); // In case it was set to unavailable
        }
        // 2) Set capability states
        return this.setCapabilityValue('onoff', turnOn);
      })
      .then(() => {
        const newPowerText = (newPower === 1) ? 'low_power' : (newPower === 2) ? 'medium_power' : 'high_power';
        return this.setCapabilityValue(this.max_power_capability_name, newPowerText);
      })
      .then(() => {
        const newPowerWatt = (newPower === 1) ? this.HeaterNomPower : (newPower === 2) ? this.HeaterNomPower2 : (this.HeaterNomPower + this.HeaterNomPower2);

        // 3) Send trigger action
        if (newPower !== this.max_power) {
          const tokens = { max_power: newPowerWatt };
          return this.driver.ready().then(() => {
            return this.driver.triggerMaxPowerChanged(this, tokens, {});
          });
        }
        return Promise.resolve();
      })
      .then(() => {
        // 4) Set internal state
        this.is_on = turnOn;
        this.max_power = newPower;
        return Promise.resolve();
      })
      .catch(err => {
        const newErr = `myUplink error: ${err}`;
        this.setUnavailable(newErr);
        return Promise.reject(newErr);
      });
  }

  async setAmbientTemp(deviceId, ambientTemp) {
    if ((Number.isNaN(+ambientTemp)) || (this.outsideTemp === ambientTemp)) {
      return Promise.resolve();
    }
    ambientTemp = Math.round(+ambientTemp);
    // Apply clamp to avoid myUplink errors
    if (ambientTemp < 10) ambientTemp = 10;
    if (ambientTemp > 35) ambientTemp = 35;
    // this.log("New ambient temperature:" + String(ambientTemp))
    this.setSettings({ ambient_temperature: ambientTemp });
    this.outsideTemp = ambientTemp;
    const keyChange = {};
    keyChange[keyMap['ambient_temperature']] = this.outsideTemp;
    return this.oAuth2Client.setDevicePoint(deviceId, keyChange)
      .then(response => {
        if (response) {
          this.setAvailable(); // In case it was set to unavailable
        }
        return Promise.resolve();
      })
      .catch(err => {
        this.setUnavailable(`Network problem: ${err.message}`);
        return Promise.reject(err);
      });
  }

  /**
   * Override the setSettings function to make sure the settings are of right type
   */
  async toSettings(newSettings) {
    const toSetSettings = clone(newSettings);
    toSetSettings.nordpool_price_region = String(toSetSettings.nordpool_price_region);
    // toSetSettings.num_expensive_hours = toSetSettings.num_expensive_hours;
    // toSetSettings.min_remain_heat = toSetSettings.min_remain_heat;
    // toSetSettings.num_cheap_hours = toSetSettings.num_cheap_hours;
    // toSetSettings.temp_inc_cheap_hours = toSetSettings.temp_inc_cheap_hours;
    toSetSettings.controling_device = String(toSetSettings.controling_device);
    if (this.brokenSpotPrice && (toSetSettings.controling_device === '6')) {
      // Price control (6) is not available on all tanks, set to Homey (8)
      toSetSettings.controling_device = '8';
    }
    toSetSettings.TankVolume = String(toSetSettings.TankVolume);
    toSetSettings.SerialNo = String(toSetSettings.SerialNo); // Also in this.getData().deviceId
    toSetSettings.HeaterNomPower = String(toSetSettings.HeaterNomPower);
    toSetSettings.HeaterNomPower2 = String(toSetSettings.HeaterNomPower2);
    toSetSettings.LeakageConstant = `${String(this.leakageConstant)} W/Δ°C`;
    toSetSettings.systemId = String(this.getData().systemId);
    toSetSettings.systemName = String(this.getData().systemName);
    toSetSettings.deviceId = String(this.getData().deviceId);
    toSetSettings.deviceName = String(this.getData().deviceName);
    toSetSettings.firmwareVersion = String(toSetSettings.firmwareVersion);
    return super.setSettings(toSetSettings);
  }

  /**
   * onOAuth2Init is called when the device is initialized.
   */
  async onOAuth2Init() {
    this.log('MyHoiaxDevice was initialized');
    try {
      let available = true;
      this.setUnavailable('Initializing device.');
      this.deviceId = this.getData().deviceId;
      this.intervalID = undefined;
      this.initializeID = undefined;
      this.deviceType = this.getStoreValue('deviceType');
      this.killed = false;

      // If device type has not been detected previously, detect it once and for all
      if (!this.deviceType) {
        let tankSize;
        while (!Array.isArray(tankSize) || tankSize.length !== 1) {
          try {
            tankSize = await this.oAuth2Client.getDevicePoints(this.deviceId, keyMap.TankVolume);
            if (!Array.isArray(tankSize) || tankSize.length !== 1) {
              await sleep(retryOnOkWaitTime);
            }
          } catch (err) {
            tankSize = undefined;
            this.setUnavailable(`Network problem: ${err.message}`);
            await sleep(retryOnErrorWaitTime);
          }
        }
        switch (parseInt(tankSize[0].value, 10)) {
          case CONNECTED_200_PROPERTIES.size: this.deviceType = DEVICE_TYPE_CONNECTED_200; break;
          case CONNECTED_300_PROPERTIES.size: this.deviceType = DEVICE_TYPE_CONNECTED_300; break;
          default: this.deviceType = DEVICE_TYPE_UNKNOWN; break;
        }
        this.setStoreValue('deviceType', this.deviceType).catch(this.error);
      }

      // Capability update from version 1.3.3
      if (!this.hasCapability('meter_power.leak_accum')) {
        await this.addCapability('meter_power.leak_accum');
      }
      if (!this.hasCapability('measure_power.leak')) {
        await this.addCapability('measure_power.leak');
      }
      if (!this.hasCapability('measure_humidity.leak_relation')) {
        await this.addCapability('measure_humidity.leak_relation');
      }

      // Capability update from version 1.7.11
      if (!this.hasCapability('button.reset_leakage')) {
        await this.addCapability('button.reset_leakage');
      }

      // Capability update from version 1.6.0
      // In case the tank is Connected 300 the capability is wrong
      if (this.hasCapability('max_power') && (this.deviceType === DEVICE_TYPE_CONNECTED_300)) {
        this.log('Performing Connected 300 fix');
        await this.removeCapability('max_power');
        await this.addCapability('max_power_3000');
      }

      // As a consequence of version 1.6.0 the max_power capability is now device specific
      if (this.hasCapability('max_power')) {
        this.max_power_capability_name = 'max_power';
        this.max_power_action_name = 'change-maxpower';
      } else if (this.hasCapability('max_power_3000')) {
        this.max_power_capability_name = 'max_power_3000';
        this.max_power_action_name = 'change-maxpower-3000';
      } else {
        throw new Error('This device is broken, please delete it and reinstall it');
      }

      // A bug introduced on July 20th 2022 12:14 PM set the prevAccumTime incorrect and as such completely invalidate this.accumulatedLeakage
      if (this.getStoreValue('prevAccumTime') === null) {
        // New install so not affected by the bug
        this.setStoreValue('July20thBugHandled', 1);
        this.log('New install, ignore fix for July20thBug');
      } else if (this.getStoreValue('July20thBugHandled') === null) {
        const oldLeak = this.getStoreValue('accumulatedLeakage');
        if ((oldLeak > 500) || (oldLeak < 0)) {
          this.homey.notifications.createNotification({ excerpt: this.homey.__('info.july20thBug') });
          this.setStoreValue('accumulatedLeakage', 0);
        }
        this.setStoreValue('July20thBugHandled', 1);
        this.log('July20thBug handled');
      }

      // Initial state for leakage heat
      this.prevRelationTime = undefined;
      this.prevRelationUse = undefined;
      this.prevRelationLeak = undefined;
      this.prevAccumTime = new Date(this.getStoreValue('prevAccumTime'));
      this.accumulatedLeakage = this.getStoreValue('accumulatedLeakage');
      if (!(this.prevAccumTime instanceof Date) || this.getStoreValue('prevAccumTime') === null) this.prevAccumTime = new Date();
      if (!this.accumulatedLeakage) this.accumulatedLeakage = 0;
      const deviceProperties = (this.deviceType === DEVICE_TYPE_CONNECTED_300) ? CONNECTED_300_PROPERTIES : CONNECTED_200_PROPERTIES;
      this.leakageConstant = deviceProperties.leakage_constant; // Set it static here because those running debug versions have incorrect leakage
      if (!this.leakageConstant) {
        // In case the leakage constant has not been measured for a device, just scale a known one to have something until
        // it is more accurate
        this.leakageConstant = (CONNECTED_200_PROPERTIES.leakage_constant * deviceProperties.size) / CONNECTED_200_PROPERTIES.size;
      }

      // Defaults for values fetched from myUplink in case myUplink is unavailable
      this.outsideTemp = 24; // Updated by a flow if set up
      this.tankVolume = deviceProperties.size;
      this.HeaterNomPower = deviceProperties.element1_power;
      this.HeaterNomPower2 = deviceProperties.element2_power;

      // === Debug code to show if new features has been added ===
      // let all_features = await this.oAuth2Client.getDevicePoints(this.deviceId);
      // this.log(JSON.stringify(all_features))

      // Fetch the heater mode in order to set it to Homey and check if myuplink is broken
      let heaterMode;
      while (!Array.isArray(heaterMode) || heaterMode.length !== 1) {
        try {
          heaterMode = await this.oAuth2Client.getDevicePoints(this.deviceId, '500');
          if (!Array.isArray(heaterMode) || heaterMode.length !== 1) {
            await sleep(retryOnOkWaitTime);
          }
        } catch (err) {
          heaterMode = undefined;
          this.setUnavailable(`Network problem: ${err.message}`);
          await sleep(retryOnErrorWaitTime);
        }
      }
      if (!heaterMode[0]) {
        // Given the while loop above this should not happen so throw error
        throw new Error(`Problems reading heater mode: ${heaterMode.message}`);
      }
      // Check if myUplink is broken. Apparently version 1.23 (2262) is
      this.brokenSpotPrice = true;
      for (let i = 0; i < heaterMode[0].enumValues.length; i++) {
        if (heaterMode[0].enumValues[i].value === '6') {
          this.brokenSpotPrice = false;
        }
      }
      if (this.brokenSpotPrice) {
        this.log('The Spot Price setting seem to be broken and will be disabled');
      }

      // Make sure that the Heater mode is controllable - set to External mode (but only if first time the app is run)
      this.isFirstTime = this.getStoreValue('isFirstTime') === null;
      if (this.isFirstTime) {
        if (heaterMode[0].value !== '8') { // 8 == External
          await this.oAuth2Client.setDevicePoint(this.deviceId, { 500: '8' })
            .then(response => {
              if (response) {
                available = true;
              } else {
                available = false;
              }
            })
            .catch(err => {
              available = false;
              this.setUnavailable(`Network problem: ${err.message}`);
            });
        }
        this.isFirstTime = false;
        this.setStoreValue('isFirstTime', this.isFirstTime).catch(this.error);
      }

      // Set heater max power to 2000 W
      this.max_power = 3;
      this.is_on = true;

      // Prepare for reverse indexing of state entries
      this.reverseKeyMap = {};
      const keys = Object.keys(keyMap);
      for (let keyNr = 0; keyNr < keys.length; keyNr++) {
        this.reverseKeyMap[keyMap[keys[keyNr]]] = keys[keyNr];
      }

      // Update internal state
      let statesLeft = Object.values(keyMap);
      if (this.brokenSpotPrice) {
        statesLeft = statesLeft.filter(value => +value < 544 || +value > 548);
      }
      await this.initializeInternalStates(statesLeft);

      // Custom flows
      const OnMaxPowerAction = this.homey.flow.getActionCard(this.max_power_action_name);

      OnMaxPowerAction.registerRunListener(async state => {
        return this.setHeaterState(
          this.deviceId,
          this.is_on,
          (state['max_power'] === 'low_power') ? 1
            : (state['max_power'] === 'medium_power') ? 2
              : 3
        );
      });

      const OnAmbientAction = this.homey.flow.getActionCard('change-ambient-temp');

      OnAmbientAction.registerRunListener(async state => {
        return this.setAmbientTemp(this.deviceId, state['ambient_temp']);
      });

      // Register on/off handling
      this.registerCapabilityListener('onoff', async turnOn => {
        return this.setHeaterState(this.deviceId, turnOn, this.max_power);
      });

      // Register ambient temperature handling (probably not required as the capability is hidden)
      this.registerCapabilityListener('ambient_temp', async ambientTemp => {
        return this.setAmbientTemp(this.deviceId, ambientTemp);
      });

      // Register max power handling
      this.registerCapabilityListener(this.max_power_capability_name, async value => {
        let newPower = 3; // High power
        if (value === 'low_power') {
          newPower = 1;
        } else if (value === 'medium_power') {
          newPower = 2;
        }
        return this.setHeaterState(this.deviceId, this.is_on, newPower);
      });

      // Register target temperature handling
      this.registerCapabilityListener('target_temperature', async value => {
        this.log('Set target temp:', value);
        return this.oAuth2Client.setDevicePoint(this.deviceId, { 527: value })
          .then(response => {
            if (response) {
              this.setAvailable(); // In case it was set to unavailable
            }
            return Promise.resolve();
          })
          .catch(err => {
            this.setUnavailable(`Network problem: ${err.message}`);
            return Promise.reject(err);
          });
      });

      // Register maintainance action to reset accumulater leakage heat
      this.registerCapabilityListener('button.reset_leakage', async () => {
        this.log('Accumulated leakage was reset');
        this.setStoreValue('accumulatedLeakage', 0);
      });

      if (available) {
        this.setAvailable();
      }
    } catch (err) {
      // Safer to set device unavailable state than to throw the error. Reason being onOAuth2Deleted is not called if this throw errors
      this.setUnavailable(`Unknown error, may need to reinstall device: ${err}`);
    }
  }

  //
  async onOAuth2Deleted() {
    this.killed = true;
    // Make sure the interval is cleared if it was started, otherwise it will continue to
    // trigger but on an unknown device.
    if (this.intervalID !== undefined) {
      clearInterval(this.intervalID);
      this.intervalID = undefined;
    }
    if (this.initializeID !== undefined) {
      clearTimeout(this.initializeID);
      this.initializeID = undefined;
    }
  }

  // Called once on onOAuth2Init - will retry to initialize device for eternity until successful
  async initializeInternalStates(statesLeft) {
    let fetchStateError;
    this.initializeID = undefined;
    this.log(`Fetching states: ${JSON.stringify(statesLeft)}`);
    try {
      const stateToFetch = statesLeft.join(',');
      let stateRequest;
      try {
        stateRequest = await this.oAuth2Client.getDevicePoints(this.deviceId, stateToFetch);
        this.log(`State response: ${JSON.stringify(stateRequest)}`);
      } catch (innerErr) {
        throw new Error(`Network problem: ${innerErr.message}`);
      }

      const fetchedStates = {};
      if (Array.isArray(stateRequest)) {
        for (let val = 0; val < stateRequest.length; val++) {
          if ('parameterId' in stateRequest[val]) {
            if (stateRequest[val].writable === false) {
              fetchedStates[this.reverseKeyMap[stateRequest[val].parameterId]] = stateRequest[val].strVal; // Value with unit
              const value = parseInt(stateRequest[val].value, 10);
              // This is only required for unknown Høiax devices as these should match with the defaults for all defined devices
              switch (stateRequest[val].parameterId) {
                case 100: this.outsideTemp = value; break;
                case 503: this.HeaterNomPower = value; break;
                case 504: this.HeaterNomPower2 = value; break;
                case 526: this.tankVolume = value; break;
                default: break; // Other values are writeable, so not handled here
              }
            } else {
              fetchedStates[this.reverseKeyMap[stateRequest[val].parameterId]] = stateRequest[val].value; // Value without unit
            }
          }
        }
      }
      if (Object.keys(fetchedStates).length > 0) {
        try {
          fetchedStates.firmwareVersion = 'unknown';
          const firmwareResponse = await this.oAuth2Client.getDeviceInfo(this.deviceId);
          if (firmwareResponse && ('firmware' in firmwareResponse) && ('currentFwVersion' in firmwareResponse.firmware)) {
            fetchedStates.firmwareVersion = firmwareResponse.firmware.currentFwVersion;
          }
          await this.toSettings(fetchedStates);
          statesLeft = statesLeft.filter(value => {
            return !(this.reverseKeyMap[value] in fetchedStates);
          });
        } catch (innerErr) {
          // Nothing I possibly can do? Disk full?
          throw new Error(`Could not save settings at this time, will retry in a bit: ${innerErr}`);
        }
      }
    } catch (err) {
      // Can be 'Network problem' or 'toSettings failed' (disk full?)
      fetchStateError = err;
    } finally {
      try {
        if ((statesLeft.length > 0) && (this.fullListReported === undefined)) {
          const fullList = await this.oAuth2Client.getDevicePoints(this.deviceId, []);
          this.log(`Failed to get some device points, this is the full list: ${JSON.stringify(fullList)}`);
          this.fullListReported = true;
        }
      } catch (err) {} // No need for error handling as this is just debug prints
      if (statesLeft.length > 0) {
        // The device is still not initialized
        this.log(`Could not fetch the following states: ${JSON.stringify(statesLeft)}`);
        if (!fetchStateError) {
          fetchStateError = 'myUplink server is unresponsive / bad internet connection. If it does not resolve in a few minutes please contact the developer.';
        }
        this.setUnavailable(`Unable to initialize driver (${fetchStateError})`);
        // Retry this function again in a while
        this.log(`Retry these states in a while: ${JSON.stringify(statesLeft)}`);
        this.initializeID = setTimeout(() => {
          if (this.killed) return;
          this.initializeInternalStates(statesLeft);
        }, retryOnErrorWaitTime);
      } else {
        // Device finally ok, update internal state every 5 minute:
        this.updateStateCounter = 0;
        this.errCnt = 0;
        await this.updateState(this.deviceId)
          .catch(err => {}); // Do not care, the setInterval below wil refresh the state anyway
        if (!this.killed) { // In some rare case onOAuth2Deleted could have happened within this actual function
          this.intervalID = setInterval(() => {
            if (this.updateStateCounter <= 0) {
              this.updateState(this.deviceId)
                .then(() => {
                  this.updateStateCounter = 4; // Wait 5 minutes to update normally
                  this.errCnt = 0;
                })
                .catch(err => {
                  this.updateStateCounter = Math.min(this.errCnt, 4); // Wait 1-5 minutes to update on error
                  this.errCnt += 1;
                });
            } else {
              this.updateStateCounter--;
            }
          }, 1000 * 60 * 1);
        }
        this.log('Device init complete');
        this.setAvailable();
      }
    }
  }

  // Logs how much leakage heat that we have had.
  // A good description of leakage heat is here:
  // https://vannbaserte.nemitek.no/833-artikkel-vannbaserte-oppvarmings-og-kjolesystemer-2014/beredertemperatur-og-varmetap/163668
  async logLeakage(totalUsage, temperature, inTank, debugTime = undefined) {
    this.log(`logLeakage(${String(totalUsage)}, ${String(temperature)}, ${String(inTank)}, ${String((new Date()).getTime())});`);
    const newTime = Number.isNaN(+debugTime) ? new Date() : debugTime;
    // Make sure input is valid
    if (Number.isNaN(+totalUsage) || Number.isNaN(+temperature) || Number.isNaN(+inTank)) {
      throw (new Error(`Invalid values read from water heater: Usage=${totalUsage}, Temp=${temperature}, HeatAvailable=${inTank}`));
    }
    const outerTempDiff = temperature - this.outsideTemp;

    const accumTimeDiff = newTime - this.prevAccumTime;
    const currentLeakage = this.leakageConstant * outerTempDiff; // W
    const timedLeakage = (currentLeakage * accumTimeDiff) / (60 * 60 * 1000000); // kWh
    if (!Number.isNaN(+timedLeakage)) {
      this.prevAccumTime = newTime;
      this.accumulatedLeakage += timedLeakage;
      // Update statistics
      this.setCapabilityValue('measure_power.leak', currentLeakage);
      this.setCapabilityValue('meter_power.leak_accum', this.accumulatedLeakage);
      // Update stores only once every day only to save the homey disk:
      const prevUpdateTime = new Date(this.getStoreValue('prevAccumTime'));
      if ((this.prevAccumTime - prevUpdateTime) > (24 * 60 * 60 * 1000)) {
        this.setStoreValue('prevAccumTime', this.prevAccumTime).catch(this.error);
        this.setStoreValue('accumulatedLeakage', this.accumulatedLeakage).catch(this.error);
      }
    }

    // Check relations
    if (!this.prevRelationTime) {
      this.prevRelationTime = newTime;
      this.prevRelationUse = totalUsage;
      this.prevRelationLeak = this.accumulatedLeakage;
    } else if ((newTime - this.prevRelationTime) > 24 * 60 * 60 * 1000) {
      // Once every day
      this.prevRelationTime = newTime;
      const leakedEnergy = this.accumulatedLeakage - this.prevRelationLeak;
      const addedEnergy = totalUsage - this.prevRelationUse;
      this.prevRelationUse = totalUsage;
      this.prevRelationLeak = this.accumulatedLeakage;
      const leakRelation = (addedEnergy > leakedEnergy) ? ((100 * leakedEnergy) / addedEnergy) : 100;
      this.setCapabilityValue('measure_humidity.leak_relation', leakRelation);
      this.log(`Relation: ${String(leakedEnergy)} ${String(addedEnergy)}  ${String(leakRelation)}`);
    } else {
      this.log(`Time lapsed since last leak_check:${String((newTime - this.prevRelationTime) / (1000 * 60 * 60))} hours`);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed');

    const keyChange = {};
    for (let keyNr = 0; keyNr < changedKeys.length; keyNr++) {
      this.log(`${changedKeys[keyNr]} changed: `, newSettings[changedKeys[keyNr]], ' (key: ', keyMap[changedKeys[keyNr]], ')');
      const keyIndex = keyMap[changedKeys[keyNr]];
      if (!(this.brokenSpotPrice && +keyIndex >= 544 && +keyIndex <= 548)) {
        // Only change the settings that are available for the tank in question
        keyChange[keyIndex] = newSettings[changedKeys[keyNr]];
      }
    }
    if (Object.keys(keyChange).length > 0) {
      return this.oAuth2Client.setDevicePoint(this.deviceId, keyChange)
        .then(response => {
          if (response) {
            this.setAvailable(); // In case it was set to unavailable
          }
          return Promise.resolve();
        })
        .catch(err => {
          this.setUnavailable(`Network problem: ${err.message}`);
          return Promise.reject(err);
        });
    }
    return Promise.resolve();
  }

  async updateState(deviceId) {
    return Promise.resolve()
      .then(() => {
        const needKeys = [302, 303, 400, 404, 517, 527, 528];
        const pendingKeys = Object.keys(this.oAuth2Client.pendingDevicePoints).map(Number).filter(number => !needKeys.includes(number));
        needKeys.push(...pendingKeys);
        return this.oAuth2Client.getDevicePoints(deviceId, needKeys.join(','));
      })
      .then(devPoints => {
        if (!Array.isArray(devPoints)) {
          return Promise.reject(new Error('Invalid state from myUplink'));
        }
        // Got updated state: Set internal state
        let logTotal;
        let logTemp;
        let logStored;
        const promises = [];
        for (let loop = 0; loop < devPoints.length; loop++) {
          if ('parameterId' in devPoints[loop] && 'value' in devPoints[loop]) {
            switch (parseInt(devPoints[loop].parameterId, 10)) {
              case 100:
                this.outsideTemp = devPoints[loop].value;
                break;
              case 405: // 405 = HeaterEfficiency (deprecated)
                // this.setCapabilityValue('measure_humidity.efficiency', devPoints[loop].value)
                break;
              case 302: // 302 = EnergyStored
                promises.push(this.setCapabilityValue('meter_power.in_tank', devPoints[loop].value));
                logStored = devPoints[loop].value;
                break;
              case 303: // 303 = EnergyTotal
                promises.push(this.setCapabilityValue('meter_power.accumulated', devPoints[loop].value));
                logTotal = devPoints[loop].value;
                break;
              case 400: // 400 = EstimatedPower
                promises.push(this.setCapabilityValue('measure_power', devPoints[loop].value));
                break;
              case 404: // 404 = FillLevel
                promises.push(this.setCapabilityValue('measure_humidity.fill_level', devPoints[loop].value));
                break;
              case 517: // 517 = Requested power
                {
                  const currentMaxPower = +devPoints[loop].value;
                  // Value 0 = Off, 1 = this.HeaterNomPower, 2 = this.HeaterNomPower2, 3 = this.HeaterNomPower+this.HeaterNomPower2
                  if (currentMaxPower === 0) {
                    // Heater is off
                    this.is_on = false;
                  } else {
                    this.is_on = true;
                    this.max_power = currentMaxPower;
                  }
                  promises.push(this.setHeaterState(deviceId, this.is_on, this.max_power));
                }
                break;
              case 527: // 527 = Requested temperature
                promises.push(this.setCapabilityValue('target_temperature', devPoints[loop].value));
                break;
              case 528: // 528 = Measured temperature
                promises.push(this.setCapabilityValue('measure_temperature', devPoints[loop].value));
                logTemp = devPoints[loop].value;
                break;
              default:
              {
                const newErr = new Error(`Device point parameterId ${String(devPoints[loop].parameterId)} not handled`);
                this.log(newErr);
                promises.push(Promise.resolve()); // Do not reject even thoug additional handlig would be nice
                break;
              }
            }
          } // Else parameterId not set.... this is only the case when internet connection is bad
        }
        if (logTotal === undefined || logTemp === undefined || logStored === undefined) {
          this.log('Invalid response');
          this.log(JSON.stringify(devPoints));
          // Should probably set device to unavailable but it's probably ok missing some values
          // throw (new Error(`Sorry about the crash, send this to the developer: ${JSON.stringify(devPoints)}`));
        } else {
          this.logLeakage(logTotal, logTemp, logStored);
        }

        return Promise.all(promises)
          .then(() => {
            if (devPoints.length > 0) {
              this.setAvailable(); // In case it was set to unavailable
            }
            // Retry pending state from earlier
            if (Object.keys(this.oAuth2Client.pendingDevicePoints).length > 0) {
              return this.oAuth2Client.setDevicePoint(deviceId, this.oAuth2Client.pendingDevicePoints);
            }
            return Promise.resolve();
          })
          .then(() => Promise.resolve({ ok: true }));
      })
      .then(response => {
        if (response && response.ok) {
          this.setAvailable(); // pending State has been resolved
        }
        return Promise.resolve();
      })
      .catch(err => {
        const newErr = new Error(`Network problem: ${err.message}`);
        this.setUnavailable(newErr);
        return Promise.reject(newErr);
      });
  }

}

module.exports = MyHoiaxDevice;
