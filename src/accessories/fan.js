'use strict';

class FanAccessory {
  constructor(platform, accessory, config) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.log = platform.log;
    this.api = platform.bestinApi;
    this.isOn = false;
    this.speed = 0; // 0=off, 1=low(33), 2=mid(66), 3=high(100)

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
            await this.api.controlVentilator('low');
            this.isOn = true;
            this.speed = 33;
          } else {
            await this.api.controlVentilator('off');
            this.isOn = false;
            this.speed = 0;
          }
        } catch (e) {
          this.log.error('환기 제어 실패:', e.message);
          throw new platform.api.hap.HapStatusError(-70402);
        }
      });

    service.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 33 })
      .onGet(() => this.speed)
      .onSet(async (value) => {
        try {
          let action;
          if (value <= 0) {
            action = 'off';
          } else if (value <= 33) {
            action = 'low';
          } else if (value <= 66) {
            action = 'mid';
          } else {
            action = 'high';
          }
          await this.api.controlVentilator(action);
          this.isOn = action !== 'off';
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
        else if (status === 'high') this.speed = 100;
        else this.speed = 0;

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
