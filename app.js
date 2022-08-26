'use strict';

const { request } = require('urllib'); // This adds 512kB to the app
const { OAuth2App } = require('homey-oauth2app');
const HoiaxOAuth2Client = require('./lib/HoiaxOAuth2Client');

class MyApp extends OAuth2App {

  static DEBUG = false;
  static OAUTH2_CLIENT = HoiaxOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = this.DEBUG; // Default: false
  static OAUTH2_MULTI_SESSION = false; // Default: false
  static OAUTH2_DRIVERS = ['my_driver']; // Default: all drivers

  /**
   * onInit is called when the app is initialized.
   */
  async onOAuth2Init() {
    if (this.DEBUG) {
      this.log('Hoiax has been initialized');
    }

    // Notify the user about the new app
    const spareGrisVersion = await this.checkSpareGrisVersion();
    const userNotifiedSparegris = this.homey.settings.get('userNotifiedSparegris');
    if ((!userNotifiedSparegris) && (spareGrisVersion === undefined)) {
      this.homey.notifications.createNotification({ excerpt: this.homey.__('info.sparegris') });
      this.homey.settings.set('userNotifiedSparegris', 'yes');
    }
  }

  /**
   * Checks if Sparegris is installed
   * @return the version number if sparegris is installed. Undefined otherwise.
   */
  async checkSpareGrisVersion() {
    // Can not use the homey.api as such:
    //   const spareGrisInstalled = this.homey.api.getApiApp('no.sparegris').getInstalled();
    // Must use web-api instead:
    const webAddress = 'http://localhost/api/app/no.sparegris/getVersion';
    try {
      const { data, res } = await request(webAddress, { dataType: 'json' });
      if (res.status === 200) {
        return JSON.parse(data).version;
      }
      return undefined;
    } catch (err) {
      return undefined;
    }
  }

}

module.exports = MyApp;
