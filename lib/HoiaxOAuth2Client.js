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
      path: '/systems/' + systemId + '/smart-home-mode',
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
  // '503': 'HeaterNomPower'              - R   - ignore
  // '504': 'HeaterNomPower2'             - R   - ignore
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
  // '518': 'SerialNo',                   - R   - ignore
  // '523': 'TankRegulating',             - R   - ignore
  // '526': 'TankVolume',                 - R   - TBD
  // '527': 'TargetSetpoint'              - R/W - handled
  // '528': 'Temperature',                - R   - handled
  // '531': 'TotalRuntime',               - R   - ignore
  // '532': 'Uptime',                     - R   - ignore
  // '533': 'WifiUptime',                 - R   - ignore
  // '534': 'MqttUptime',                 - R   - ignore
  async getDevicePoints( deviceId, parameters ) {
    //this.log("getDevicePoints")
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