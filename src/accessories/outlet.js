'use strict';

class OutletAccessory {
  constructor(platform, accessory, config) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.log = platform.log;
    this.api = platform.bestinApi;
    this.isOn = false;

    const Service = platform.api.hap.Service;
    const Characteristic = platform.api.hap.Characteristic;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'BESTIN')
      .setCharacteristic(Characteristic.Model, 'Outlet')
      .setCharacteristic(Characteristic.SerialNumber, config.uniqueId);

    // Remove stale Lightbulb service from cache
    const staleLightbulb = accessory.getService(Service.Lightbulb);
    if (staleLightbulb) accessory.removeService(staleLightbulb);

    const service = accessory.getService(Service.Outlet)
      || accessory.addService(Service.Outlet, config.displayName);

    service.getCharacteristic(Characteristic.On)
      .onGet(() => this.isOn)
      .onSet(async (value) => {
        try {
          await this.api.controlOutlet(config.roomNum, config.switchNum, value ? 'on' : 'off');
          this.isOn = value;
        } catch (e) {
          this.log.error(`콘센트 제어 실패 (${config.displayName}):`, e.message);
          throw new platform.api.hap.HapStatusError(-70402);
        }
      });

    service.getCharacteristic(Characteristic.OutletInUse)
      .onGet(() => this.isOn);

    this.service = service;
    this.Characteristic = Characteristic;
  }

  async pollStatus() {
    try {
      const statuses = await this.api.getOutletStatus(this.config.roomNum);
      const status = statuses[this.config.switchNum];
      if (status !== undefined) {
        const parts = status.split('/');
        this.isOn = parts.length >= 2 ? parts[1] === 'on' : status === 'on';
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.service.updateCharacteristic(this.Characteristic.OutletInUse, this.isOn);
      }
    } catch (e) {
      this.log.debug(`콘센트 상태 조회 실패 (${this.config.displayName}):`, e.message);
    }
  }
}

module.exports = OutletAccessory;
