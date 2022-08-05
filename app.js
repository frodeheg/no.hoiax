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

    // Notify the user about the new app
    const userNotifiedSparegris = this.homey.settings.get('userNotifiedSparegris');
    if (!userNotifiedSparegris) {
      // const spareGrisInstalled = this.homey.api.getApiApp('no.sparegris').getInstalled();
      // if (!spareGrisInstalled) {
      this.homey.notifications.createNotification({ excerpt: this.homey.__('info.sparegris') });
      this.homey.settings.set('userNotifiedSparegris', 'yes');
      // }
    }
  }


}

module.exports = MyApp;
