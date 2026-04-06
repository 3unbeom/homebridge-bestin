'use strict';

const BestinApi = require('./api');
const LightAccessory = require('./accessories/light');
const OutletAccessory = require('./accessories/outlet');
const ThermostatAccessory = require('./accessories/thermostat');
const FanAccessory = require('./accessories/fan');

const PLUGIN_NAME = 'homebridge-bestin';
const PLATFORM_NAME = 'BestinPlatform';

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, BestinPlatform);
};

class BestinPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    if (!config) {
      log.warn('설정이 없습니다. config.json에 BestinPlatform을 추가해주세요.');
      return;
    }

    this.bestinApi = new BestinApi(log, {
      hostIp: config.hostIp,
      userId: config.userId,
      userPw: config.userPw,
    });

    this.api.on('didFinishLaunching', () => {
      this.log.info('BESTIN 플랫폼 초기화 시작...');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory) {
    this.log.info('캐시된 액세서리 로드:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices() {
    try {
      await this.bestinApi.login();
      this.log.info('BESTIN 로그인 성공');
    } catch (e) {
      this.log.error('BESTIN 로그인 실패:', e.message);
      return;
    }

    try {
      this.log.info('디바이스 검색 시작...');
      const deviceConfigs = [];

      // Living room (lights only, no roomNum)
      const livingRoom = this.config.livingRoom;
      if (livingRoom) {
        const livingName = livingRoom.name || '거실';
        for (const num of livingRoom.lights || []) {
          deviceConfigs.push({
            type: 'light',
            uniqueId: `light_living_switch${num}`,
            displayName: `${livingName} 조명 ${num}`,
            roomNum: null,
            switchNum: `switch${num}`,
          });
        }
      }

      // Rooms
      const rooms = this.config.rooms || [];
      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        const roomNum = room.roomNumber || (i + 1);
        const roomName = room.name || `방${roomNum}`;

        // Lights
        for (const num of room.lights || []) {
          deviceConfigs.push({
            type: 'light',
            uniqueId: `light_room${roomNum}_switch${num}`,
            displayName: `${roomName} 조명 ${num}`,
            roomNum,
            switchNum: `switch${num}`,
          });
        }

        // Outlets
        for (const num of room.outlets || []) {
          deviceConfigs.push({
            type: 'outlet',
            uniqueId: `outlet_room${roomNum}_switch${num}`,
            displayName: `${roomName} 콘센트 ${num}`,
            roomNum,
            switchNum: `switch${num}`,
          });
        }

        // Thermostat
        deviceConfigs.push({
          type: 'thermostat',
          uniqueId: `thermostat_room${roomNum}`,
          displayName: `${roomName} 난방`,
          unitNum: `room${roomNum}`,
        });
      }

      // Ventilator
      deviceConfigs.push({
        type: 'fan',
        uniqueId: 'ventil',
        displayName: '환기장치',
      });

      // Register accessories
      const activeIds = new Set();
      for (const dc of deviceConfigs) {
        const uuid = this.api.hap.uuid.generate(dc.uniqueId);
        activeIds.add(uuid);

        let accessory = this.accessories.find(a => a.UUID === uuid);
        let isNew = false;

        if (!accessory) {
          accessory = new this.api.platformAccessory(dc.displayName, uuid);
          isNew = true;
        }

        accessory.context.device = dc;
        this.setupAccessory(accessory, dc);

        if (isNew) {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.log.info('새 액세서리 등록:', dc.displayName);
        }
      }

      // Remove stale cached accessories
      const stale = this.accessories.filter(a => !activeIds.has(a.UUID));
      if (stale.length > 0) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
        this.log.info(`오래된 액세서리 ${stale.length}개 제거`);
      }

      this.log.info(`총 ${deviceConfigs.length}개 디바이스 설정 완료`);
    } catch (e) {
      this.log.error('디바이스 검색 중 오류:', e.message);
      this.log.error(e.stack);
    }
  }

  setupAccessory(accessory, dc) {
    switch (dc.type) {
      case 'light':
        new LightAccessory(this, accessory, dc);
        break;
      case 'outlet':
        new OutletAccessory(this, accessory, dc);
        break;
      case 'thermostat':
        new ThermostatAccessory(this, accessory, dc);
        break;
      case 'fan':
        new FanAccessory(this, accessory, dc);
        break;
    }
  }
}
