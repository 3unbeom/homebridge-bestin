'use strict';

class LightAccessory {
  constructor(platform, accessory, config) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.log = platform.log;
    this.api = platform.bestinApi;
    this.isOn = false;

    const Service = platform.api.hap.Service;
    const Characteristic = platform.api.hap.Characteristic;

    // Accessory info
    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'BESTIN')
      .setCharacteristic(Characteristic.Model, 'Light')
      .setCharacteristic(Characteristic.SerialNumber, config.uniqueId);

    // Lightbulb service
    const service = accessory.getService(Service.Lightbulb)
      || accessory.addService(Service.Lightbulb, config.displayName);

    service.getCharacteristic(Characteristic.On)
      .onGet(() => this.isOn)
      .onSet(async (value) => {
        const action = value ? 'on' : 'off';
        try {
          await this.api.controlLight(
            config.roomNum,
            config.switchNum,
            action,
          );
          this.isOn = value;
        } catch (e) {
          this.log.error(`조명 제어 실패 (${config.displayName}):`, e.message);
          throw new platform.api.hap.HapStatusError(-70402);
        }
      });

    this.service = service;
    this.Characteristic = Characteristic;

    // Poll status
    // Initial status fetch on startup
    this.pollStatus();
  }

  async pollStatus() {
    try {
      const statuses = await this.api.getLightStatus(
        this.config.roomNum,
      );
      const status = statuses[this.config.switchNum];
      if (status !== undefined) {
        this.isOn = status === 'on';
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
      }
    } catch (e) {
      this.log.debug(`조명 상태 조회 실패 (${this.config.displayName}):`, e.message);
    }
  }
}

module.exports = LightAccessory;
