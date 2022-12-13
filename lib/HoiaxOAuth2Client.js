/* eslint-disable comma-dangle */

'use strict';

const { URLSearchParams } = require('url');
const fetch = require('node-fetch');

const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');
// const HoiaxOAuth2Token = require('./HoiaxOAuth2Token.js');

class HoiaxOAuth2Client extends OAuth2Client {

  // Required:
  static API_URL = 'https://api.myuplink.com/v2';
  static TOKEN_URL = 'https://api.myuplink.com/oauth/token';
  static AUTHORIZATION_URL = 'https://api.myuplink.com/oauth/authorize';
  static SCOPES = ['READSYSTEM WRITESYSTEM offline_access'];

  // Optional:
  // static TOKEN = HoiaxOAuth2Token; // Default: OAuth2Token
  // static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

  // Overload what needs to be overloaded here

  // async onHandleNotOK({ body }) {
  //   throw new OAuth2Error(body.error);
  // }

  async onInit() {
    this.log('*** HØIAX onInit ***');
    this.pendingDevicePoints = {};
    this.confirmedDevicePoints = {};
  }

  // async onShouldRefreshToken({ status }) {
  //   console.log(`*** HØIAX onShouldRefreshToken *** (status: ${status})`);
  //   return true;
  //   return super.onShouldRefreshToken({ status });
  //   return status === 401;
  // }

  async onRefreshToken() {
    this.log('*** HØIAX onRefreshToken ***');
    // return super.onRefreshToken();
    const token = this.getToken();
    if (!token) {
      throw new OAuth2Error('Missing Token');
    }

    if (!token.isRefreshable()) {
      throw new OAuth2Error('Token cannot be refreshed');
    }

    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('client_id', this._clientId);
    body.append('client_secret', this._clientSecret);
    body.append('refresh_token', token.refresh_token);

    const response = await fetch(this._tokenUrl, {
      body,
      method: 'POST',
    });
    if (response.status === 401) { // 429 = rate limit, 401 = access denied, 5xx error with server
      this._token = null;
      this.emit('expired');
      this.save();
      return this.onHandleRefreshTokenError({ response });
    }

    this._token = await this.onHandleRefreshTokenResponse({ response });

    this.debug('Refreshed token!', this._token);
    this.save();

    return this.getToken();
  }

  async getDevices({ page }) {
    return this.get({
      path: '/systems/me',
      query: { page },
    });
  }

  async getSmartHomeMode(systemId) {
    this.log('getSmartHomeMode');
    return this.get({
      path: `/systems/${systemId}/smart-home-mode`,
      // query: { page },
    });
  }

  async getDeviceInfo(deviceId) {
    this.log('getDeviceInfo');
    return this.get({
      path: `/devices/${deviceId}`,
      // query: { page },
    });
  }

  // Valid device points are:
  // '100': 'Average Ambient Temperature' - R/W - handled
  // '101': 'AverageInletWaterTemp'       - R/W - handled
  // '102': 'DefaultEcoSetpoint'          - R   - ignore
  // '200': 'DefBoostSetpoint'            - R/W - ignore
  // '201': 'DefBoostTimeout'             - R/W - ignore
  // '300': 'DefVacationSetpoint'         - R/W - ignore
  // '301': 'DefVacationTimeout'          - R/W - ignore
  // '302': 'EnergyStored'                - R   - handled
  // '303': 'EnergyTotal'                 - R   - handled
  // '304': 'DisplayDimTimeout'           - R/W - ignore
  // '305': 'DisplayOffTimeout'           - R/W - ignore
  // '307': 'PowerDiff'                   - R/W - maybe
  // '308': 'TimezoneOffset'              - R/W - ignore
  // '400': 'EstimatedPower'              - R   - handled
  // '404': 'FillLevel'                   - R   - handled
  // '405': 'HeaterEfficiency'            - R   - handled
  // '406': 'CurrentHeaterMode'           - R   - ignore
  // '500': 'HeaterMode'                  - R/W - handled
  // '501': 'HeaterModeTimeout'           - R   - ignore
  // '503': 'HeaterNomPower'              - R   - handled
  // '504': 'HeaterNomPower2'             - R   - handled
  // '505': 'HeaterOn'                    - R   - ignore
  // '506': 'HeaterOn2'                   - R   - ignore
  // '507': 'HeaterRuntime'               - R   - ignore
  // '508': 'HeaterRuntime2'              - R   - ignore
  // '509': 'LastLPTime'                  - R   - ignore
  // '511': 'LegionellaFrequency'         - R/W - handled
  // '512': 'MaxWaterFlow'                - R/W - handled
  // '514': 'NextLPTime'                  - R   - ignore
  // '516': 'RegulationDiff'              - R/W - handled
  // '517': 'RequestedPower'              - R/W - handled
  // '518': 'SerialNo',                   - R   - handled
  // '523': 'TankRegulating',             - R   - ignore
  // '526': 'TankVolume',                 - R   - handled
  // '527': 'TargetSetpoint'              - R/W - handled
  // '528': 'Temperature',                - R   - handled
  // '531': 'TotalRuntime',               - R   - ignore
  // '532': 'Uptime',                     - R   - ignore
  // '533': 'WifiUptime',                 - R   - ignore
  // '534': 'MqttUptime',                 - R   - ignore
  async getDevicePoints(deviceId, parameters) {
    // this.log("getDevicePoints")
    return this.get({
      path: `/devices/${deviceId}/points`,
      query: { parameters },
    })
      .then(gotValues => {
        // Remove gotten values from pendingDevicePoints (if they match)
        // eslint-disable-next-line no-restricted-syntax
        for (let idx = 0; idx < gotValues.length; idx++) {
          const key = gotValues[idx].parameterId;
          const { value } = gotValues[idx];
          this.confirmedDevicePoints[key] = value;
          if (key in this.pendingDevicePoints) {
            // eslint-disable-next-line eqeqeq
            if (value == this.pendingDevicePoints[key]) {
              this.log(`Key ${key} confirmed ${value} = ${this.pendingDevicePoints[key]}`);
              delete this.pendingDevicePoints[key];
            } else {
              this.log(`Key ${key} not confirmed (set value: ${this.pendingDevicePoints[key]}, actual: ${value}`);
            }
          }
        }
        return Promise.resolve(gotValues);
      })
      .catch(err => {
        const newErr = new Error(`Error reading ${JSON.stringify(parameters)}: ${err}`);
        return Promise.reject(newErr);
      }); // Pass on errors
  }

  async setDevicePoint(deviceId, parameters) {
    // eslint-disable-next-line no-restricted-syntax
    for (const key in parameters) {
      if (key in this.confirmedDevicePoints
        && !(key in this.pendingDevicePoints)
        // eslint-disable-next-line eqeqeq
        && parameters[key] == this.confirmedDevicePoints[key]) {
        this.log(`Ignoring setting unchanged parameter ${key} to ${parameters[key]}}`);
        delete parameters[key];
      }
    }
    if (Object.keys(parameters).length === 0) {
      return true;
    }

    this.pendingDevicePoints = {
      ...this.pendingDevicePoints,
      ...parameters
    };

    this.log(`Setting parameters: ${Object.keys(parameters)}`);
    return this.patch({
      path: `/devices/${deviceId}/points`,
      json: parameters,
    })
      .then(res => {
        this.log(`Set response: ${JSON.stringify(res)}`);
        return Promise.resolve(res);
      })
      .catch(err => {
        const details = (err.message === '409 Conflict') ? ' (Check that the tank has power and a network connection)' : '';
        const newErr = new Error(`Failed setting ${JSON.stringify(parameters)} due to ${err.message}${details}`);
        return Promise.reject(newErr);
      });
  }

  // Retrieve active alarms for specified system.
  // Optional ignored parameters are
  // page: default value is 1
  // itemsPerPage: default value is 10
  // Accept-Language: default value is en-US
  async getActiveNotifications(systemId) {
    return this.get({
      path: `/systems/${systemId}/notifications/active`
    });
  }

  // Retrieve all (active, inactive and archived) alarms for specified system.
  // Same parameters as getActiveNotification
  async getNotifications(systemId) {
    return this.get({
      path: `/systems/${systemId}/notifications`
    });
  }

}

module.exports = HoiaxOAuth2Client;
