'use strict';

class ThermostatAccessory {
  constructor(platform, accessory, config) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.log = platform.log;
    this.api = platform.bestinApi;
    this.currentTemp = 20;
    this.targetTemp = 20;
    this.heatingActive = false;

    const Service = platform.api.hap.Service;
    const Characteristic = platform.api.hap.Characteristic;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'BESTIN')
      .setCharacteristic(Characteristic.Model, 'Thermostat')
      .setCharacteristic(Characteristic.SerialNumber, config.uniqueId);

    const service = accessory.getService(Service.Thermostat)
      || accessory.addService(Service.Thermostat, config.displayName);

    service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.heatingActive
        ? Characteristic.CurrentHeatingCoolingState.HEAT
        : Characteristic.CurrentHeatingCoolingState.OFF);

    service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          Characteristic.TargetHeatingCoolingState.OFF,
          Characteristic.TargetHeatingCoolingState.HEAT,
        ],
      })
      .onGet(() => this.heatingActive
        ? Characteristic.TargetHeatingCoolingState.HEAT
        : Characteristic.TargetHeatingCoolingState.OFF)
      .onSet(async (value) => {
        const action = value === Characteristic.TargetHeatingCoolingState.OFF ? 'off' : 'on';
        try {
          await this.api.controlThermostat(config.unitNum, action, this.targetTemp);
          this.heatingActive = action === 'on';
        } catch (e) {
          this.log.error(`난방 제어 실패 (${config.displayName}):`, e.message);
          throw new platform.api.hap.HapStatusError(-70402);
        }
      });

    service.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: -10, maxValue: 50, minStep: 0.1 })
      .onGet(() => this.currentTemp);

    service.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: 10, maxValue: 38, minStep: 0.5 })
      .onGet(() => this.targetTemp)
      .onSet(async (value) => {
        try {
          const action = this.heatingActive ? 'on' : 'off';
          await this.api.controlThermostat(config.unitNum, action, value);
          this.targetTemp = value;
        } catch (e) {
          this.log.error(`온도 설정 실패 (${config.displayName}):`, e.message);
          throw new platform.api.hap.HapStatusError(-70402);
        }
      });

    service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .setProps({
        validValues: [Characteristic.TemperatureDisplayUnits.CELSIUS],
      })
      .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(() => {});

    this.service = service;
    this.Characteristic = Characteristic;

    this.pollStatus();
  }

  async pollStatus() {
    try {
      const status = await this.api.getThermostatStatus(this.config.unitNum);
      this.heatingActive = status.active;
      this.currentTemp = status.currentTemp;
      // clamp target temp to valid range
      this.targetTemp = Math.min(38, Math.max(10, status.targetTemp));

      this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.currentTemp);
      this.service.updateCharacteristic(this.Characteristic.TargetTemperature, this.targetTemp);
      this.service.updateCharacteristic(
        this.Characteristic.CurrentHeatingCoolingState,
        this.heatingActive
          ? this.Characteristic.CurrentHeatingCoolingState.HEAT
          : this.Characteristic.CurrentHeatingCoolingState.OFF,
      );
      this.service.updateCharacteristic(
        this.Characteristic.TargetHeatingCoolingState,
        this.heatingActive
          ? this.Characteristic.TargetHeatingCoolingState.HEAT
          : this.Characteristic.TargetHeatingCoolingState.OFF,
      );
    } catch (e) {
      this.log.debug(`난방 상태 조회 실패 (${this.config.displayName}):`, e.message);
    }
  }
}

module.exports = ThermostatAccessory;
