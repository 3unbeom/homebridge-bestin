'use strict';

const http = require('http');

class BestinApi {
  constructor(log, config) {
    this.log = log;
    this.hostIp = config.hostIp;
    this.userId = config.userId;
    this.userPw = config.userPw;
    this.phpSessionId = null;
    this._cache = {};
    this._cacheTTL = 5000; // 5 second cache to deduplicate concurrent polls
    this._loginPromise = null; // in-flight login; shared across concurrent callers
  }

  _getCacheKey(method, params) {
    return `${method}:${JSON.stringify(params)}`;
  }

  _getFromCache(key) {
    const entry = this._cache[key];
    if (entry && Date.now() - entry.time < this._cacheTTL) {
      return entry.value;
    }
    return null;
  }

  _setCache(key, value) {
    this._cache[key] = { value, time: Date.now() };
  }

  login() {
    // Coalesce concurrent login calls so a burst of expired requests only
    // triggers one actual re-login on the server.
    if (!this._loginPromise) {
      this._loginPromise = this._performLogin().finally(() => {
        this._loginPromise = null;
      });
    }
    return this._loginPromise;
  }

  async _performLogin() {
    const url = `http://${this.hostIp}/webapp/data/getLoginWebApp.php?devce=WA&login_ide=${encodeURIComponent(this.userId)}&login_pwd=${encodeURIComponent(this.userPw)}`;
    const response = await this._httpGet(url, {}, true);

    const cookies = response.headers['set-cookie'];
    if (cookies) {
      for (const cookie of cookies) {
        const match = cookie.match(/PHPSESSID=([a-z0-9]+)/i);
        if (match) {
          this.phpSessionId = match[1];
          this.log.debug('PHPSESSID 획득');
          return;
        }
      }
    }

    throw new Error('PHPSESSID를 얻을 수 없습니다. 계정 정보를 확인하세요.');
  }

  _getCookieHeader() {
    return `PHPSESSID=${this.phpSessionId}; user_id=${this.userId}`;
  }

  // Session is valid whenever the server returns the BESTIN XML envelope (<imap>),
  // regardless of result="ok|fail". Session expiration returns an HTML login page
  // (typically the getLoginWebApp.php form), not an XML reply.
  _isSessionExpired(body) {
    if (!this.phpSessionId) return true;
    if (body.includes('<imap')) return false;
    return body.includes('getLoginWebApp') || body.includes('login_pwd');
  }

  async _requestWithRetry(url, headers) {
    let response = await this._httpGet(url, headers);
    if (this._isSessionExpired(response.body)) {
      this.log.info('세션 만료 감지, 재로그인...');
      await this.login();
      headers.Cookie = this._getCookieHeader();
      response = await this._httpGet(url, headers);
    }
    return response;
  }

  // Device status query
  async getDeviceStatus(reqName, params = {}) {
    const isHeat = reqName === 'remote_access_temper';
    const basePath = isHeat
      ? '/webapp/data/getHomeDevice_heat.php'
      : '/webapp/data/getHomeDevice.php';

    const queryParams = new URLSearchParams({
      req_name: reqName,
      req_action: 'status',
      ...params,
    });

    const url = `http://${this.hostIp}${basePath}?${queryParams}`;
    const response = await this._requestWithRetry(url, {
      Cookie: this._getCookieHeader(),
      'User-Agent': 'Mozilla/5.0 Chrome',
    });

    return response.body;
  }

  // Device control
  async controlDevice(reqName, params = {}) {
    const isHeat = reqName === 'remote_access_temper';
    const basePath = isHeat
      ? '/webapp/data/getHomeDevice_heat.php'
      : '/webapp/data/getHomeDevice.php';

    const queryParams = new URLSearchParams({
      req_name: reqName,
      req_action: 'control',
      ...params,
    });

    const url = `http://${this.hostIp}${basePath}?${queryParams}`;
    const response = await this._requestWithRetry(url, {
      Cookie: this._getCookieHeader(),
      'User-Agent': 'Mozilla/5.0 Chrome',
    });

    // Surface server-side failures so the accessory's onSet reports an error
    // to HomeKit instead of silently "succeeding".
    if (/result\s*=\s*"fail"/.test(response.body)) {
      throw new Error(`서버가 제어를 거부함 (${reqName})`);
    }

    return response.body;
  }

  // ---- Light helpers ----
  async getLightStatus(roomNum) {
    const cacheKey = this._getCacheKey('light', roomNum);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const params = roomNum ? { req_dev_num: roomNum } : {};
    const reqName = roomNum ? 'remote_access_light' : 'remote_access_livinglight';
    const body = await this.getDeviceStatus(reqName, params);
    const result = this._parseUnitStatuses(body);
    this._setCache(cacheKey, result);
    return result;
  }

  async controlLight(roomNum, switchNum, action) {
    const params = { req_unit_num: switchNum, req_ctrl_action: action };
    const reqName = roomNum
      ? 'remote_access_light'
      : 'remote_access_livinglight';
    if (roomNum) params.req_dev_num = roomNum;
    return this.controlDevice(reqName, params);
  }

  // ---- Outlet helpers ----
  async getOutletStatus(roomNum) {
    const cacheKey = this._getCacheKey('outlet', roomNum);
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const body = await this.getDeviceStatus('remote_access_electric', { req_dev_num: roomNum });
    const result = this._parseUnitStatuses(body);
    this._setCache(cacheKey, result);
    return result;
  }

  async controlOutlet(roomNum, switchNum, action) {
    return this.controlDevice('remote_access_electric', {
      req_dev_num: roomNum,
      req_unit_num: switchNum,
      req_ctrl_action: action,
    });
  }

  // ---- Thermostat helpers ----
  async getThermostatStatus(unitNum) {
    const body = await this.getDeviceStatus('remote_access_temper', { req_unit_num: unitNum });
    return this._parseThermostatStatus(body);
  }

  async controlThermostat(unitNum, action, targetTemp) {
    const ctrlAction = targetTemp != null ? `${action}/${targetTemp}` : action;
    return this.controlDevice('remote_access_temper', {
      req_unit_num: unitNum,
      req_ctrl_action: ctrlAction,
    });
  }

  // ---- Ventilator helpers ----
  async getVentilatorStatus() {
    const body = await this.getDeviceStatus('remote_access_ventil');
    return body; // raw response for parsing
  }

  async controlVentilator(action) {
    return this.controlDevice('remote_access_ventil', {
      req_unit_num: 'ventil',
      req_ctrl_action: action,
    });
  }

  // Parse unit_status from response like: unit_status="on" />
  _parseUnitStatuses(body) {
    const statuses = {};
    const regex = /unit_num="([^"]+)"[^>]*unit_status="([^"]+)"/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
      statuses[match[1]] = match[2];
    }

    // Fallback: simple split-based parsing
    if (Object.keys(statuses).length === 0) {
      const parts = body.split('\n').filter(Boolean);
      parts.forEach((part, i) => {
        const statusMatch = part.match(/unit_status="([^"]+)"/);
        if (statusMatch) {
          statuses[`switch${i + 1}`] = statusMatch[1];
        }
      });
    }

    return statuses;
  }

  // Parse thermostat response: unit_status="off/21.5/24.0" -> status/currentTemp/targetTemp
  _parseThermostatStatus(body) {
    const result = { active: false, currentTemp: 20, targetTemp: 20 };

    const match = body.match(/unit_status\s*=\s*"([^"]+)"/);
    if (match) {
      const parts = match[1].split('/');
      if (parts.length >= 3) {
        result.active = parts[0].trim() === 'on';
        result.currentTemp = parseFloat(parts[1]) || 20;
        result.targetTemp = parseFloat(parts[2]) || 20;
      } else {
        result.active = match[1].trim() === 'on';
      }
    }

    return result;
  }

  _httpGet(url, headers = {}, returnHeaders = false) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        timeout: 30000,
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (returnHeaders) {
            resolve({ body, headers: res.headers });
          } else {
            resolve({ body });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }
}

module.exports = BestinApi;
