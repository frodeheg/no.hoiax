const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');
const HoiaxOAuth2Token = require('./HoiaxOAuth2Token.js');

class HoiaxOAuth2Client extends OAuth2Client {

  // Required:
  static API_URL = 'https://api.myuplink.com/v2';
  static TOKEN_URL = 'https://api.myuplink.com/oauth/token';
  static AUTHORIZATION_URL = 'https://api.myuplink.com/oauth/authorize';
  static SCOPES = [ 'READSYSTEM WRITESYSTEM offline_access' ];

  // Optional:
  //static TOKEN = HoiaxOAuth2Token; // Default: OAuth2Token
  //static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

  // Overload what needs to be overloaded here

  async onHandleNotOK({ body }) {
      throw new OAuth2Error(body.error);
  }

  async getDevices( { page }) {
    return this.get({
      path: '/systems/me',
      query: { page },
    });
  }

  async getSmartHomeMode( systemId ) {
    this.log("getSmartHomeMode")
    return this.get({
      path: '/v2/systems/' + systemId + '/smart-home-mode',
      //query: { page },
    });
  }

  async getDeviceInfo( deviceId ) {
    this.log("getDeviceInfo")
    return this.get({
      path: '/devices/' + deviceId,
      //query: { page },
    });
  }

  // Valid device points are:
  // '100': 'Average Ambient Temperature' - R/W
  // '101': 'AverageInletWaterTemp'       -
  // '102': 'DefaultEcoSetpoint'
  // '200': 'DefBoostSetpoint'
  // '201': 'DefBoostTimeout'
  // '300': 'DefVacationSetpoint'
  // '301': 'DefVacationTimeout'
  // '302': 'EnergyStored'
  // '303': 'EnergyTotal'
  // '304': 'DisplayDimTimeout'
  // '305': 'DisplayOffTimeout'
  // '307': 'PowerDiff'
  // '308': 'TimezoneOffset'
  // '400': 'EstimatedPower'
  // '404': 'FillLevel'
  // '405': 'HeaterEfficiency'
  // '406': 'CurrentHeaterMode'           - R
  // '500': 'HeaterMode'                  - R/W
  // '501': 'HeaterModeTimeout'
  // '503': 'HeaterNomPower'              - R
  // '504': 'HeaterNomPower2'             - R
  // '505': 'HeaterOn'                    - R
  // '506': 'HeaterOn2'                   - R
  // '507': 'HeaterRuntime'
  // '508': 'HeaterRuntime2'
  // '509': 'LastLPTime'
  // '511': 'LegionellaFrequency'
  // '512': 'MaxWaterFlow'
  // '514': 'NextLPTime'
  // '516': 'RegulationDiff'
  // '517': 'RequestedPower'              - R/W !!!!!
  // '518': 'SerialNo',
  // '523': 'TankRegulating',
  // '526': 'TankVolume',
  // '527': 'TargetSetpoint',
  // '528': 'Temperature',
  // '531': 'TotalRuntime',
  // '532': 'Uptime',
  // '533': 'WifiUptime',
  // '534': 'MqttUptime',
  async getDevicePoints( deviceId, parameters ) {
    this.log("getDevicePoints")
    return this.get({
      path: '/devices/' + deviceId + '/points',
      query: { parameters },
    });
  }



  async setDevicePoint( deviceId, parameters ) {
    return this.patch({
      path: '/devices/' + deviceId + '/points',
      json: parameters,
    });
  }

}

module.exports = HoiaxOAuth2Client