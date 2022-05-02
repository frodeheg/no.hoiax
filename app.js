'use strict';

const { OAuth2App } = require('homey-oauth2app');
const HoiaxOAuth2Client = require('./lib/HoiaxOAuth2Client');

class MyApp extends OAuth2App {
  static DEBUG = false;
  static OAUTH2_CLIENT = HoiaxOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = this.DEBUG; // Default: false
  static OAUTH2_MULTI_SESSION = false; // Default: false
  static OAUTH2_DRIVERS = [ 'my_driver' ]; // Default: all drivers

  /**
   * onInit is called when the app is initialized.
   */
  async onOAuth2Init() {
    if (this.DEBUG) {
      this.log('Hoiax has been initialized');
    }
  }


}

module.exports = MyApp;
