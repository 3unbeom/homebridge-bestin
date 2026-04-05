'use strict';

class FanAccessory {
  constructor(platform, accessory, config) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.log = platform.log;
    this.api = platform.bestinApi;
    this.isOn = false;
    this.speed = 33; // 33=low, 66=mid, 99=high

    const Service = platform.api.hap.Service;
    const Characteristic = platform.api.hap.Characteristic;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'BESTIN')
      .setCharacteristic(Characteristic.Model, 'Ventilator')
      .setCharacteristic(Characteristic.SerialNumber, config.uniqueId);

    const service = accessory.getService(Service.Fanv2)
      || accessory.addService(Service.Fanv2, config.displayName);

    service.getCharacteristic(Characteristic.Active)
      .onGet(() => this.isOn
        ? Characteristic.Active.ACTIVE
        : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        try {
          if (value === Characteristic.Active.ACTIVE) {
            let action;
            if (this.speed <= 33) action = 'low';
            else if (this.speed <= 66) action = 'mid';
            else action = 'high';
            await this.api.controlVentilator(action);
            this.isOn = true;
          } else {
            await this.api.controlVentilator('off');
            this.isOn = false;
          }
        } catch (e) {
          this.log.error('환기 제어 실패:', e.message);
          throw new platform.api.hap.HapStatusError(-70402);
        }
      });

    service.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 99, minStep: 33 })
      .onGet(() => this.speed)
      .onSet(async (value) => {
        try {
          let action;
          if (value <= 33) {
            action = 'low';
          } else if (value <= 66) {
            action = 'mid';
          } else {
            action = 'high';
          }
          await this.api.controlVentilator(action);
          this.isOn = true;
          this.speed = value;
        } catch (e) {
          this.log.error('환기 속도 설정 실패:', e.message);
          throw new platform.api.hap.HapStatusError(-70402);
        }
      });

    this.service = service;
    this.Characteristic = Characteristic;

    this.pollStatus();
  }

  async pollStatus() {
    try {
      const body = await this.api.getVentilatorStatus();
      const statusMatch = body.match(/unit_status="([^"]+)"/);
      if (statusMatch) {
        const status = statusMatch[1];
        this.isOn = status !== 'off';
        if (status === 'low') this.speed = 33;
        else if (status === 'mid') this.speed = 66;
        else if (status === 'high') this.speed = 99;

        this.service.updateCharacteristic(
          this.Characteristic.Active,
          this.isOn ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE,
        );
        this.service.updateCharacteristic(this.Characteristic.RotationSpeed, this.speed);
      }
    } catch (e) {
      this.log.debug('환기 상태 조회 실패:', e.message);
    }
  }
}

module.exports = FanAccessory;
