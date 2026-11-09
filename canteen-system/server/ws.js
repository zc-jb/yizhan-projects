'use strict';

/**
 * WebSocket 实时推送
 * ------------------------------------------------------------------
 * 优先使用 ws 模块；如果项目中没有安装 ws，则退化为基于 Node 内置
 * http + crypto 实现的最小 RFC6455 服务端（完成握手与文本帧收发），
 * 保证厨房看板的实时推送在任何环境下都可用。
 */

const crypto = require('crypto');

let WsServer = null;
try {
  WsServer = require('ws').WebSocketServer;
} catch (err) {
  console.warn('[ws] 未安装 ws 模块，使用内置最小 WebSocket 实现');
}

const WS_PATH = '/ws';
const HEARTBEAT_MS = 30000;

function setupWebSocket(server) {
  if (WsServer) return setupWithWs(server);
  return setupFallback(server);
}

// ---------------------------------------------------------------- 基于 ws 模块

function setupWithWs(server) {
  const wss = new WsServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    // 客户端主动发 ping 时回应用，业务消息暂不处理
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', at: Date.now() }));
        }
      } catch (err) {
        // 非 JSON 消息忽略
      }
    });
    ws.send(
      JSON.stringify({
        type: 'connected',
        data: { message: '已连接厨房实时通道', online: wss.clients.size },
        at: Date.now()
      })
    );
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (err) {}
    }
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  function broadcast(payload) {
    const text = JSON.stringify(payload);
    let count = 0;
    for (const ws of wss.clients) {
      if (ws.readyState === 1) {
        try {
          ws.send(text);
          count += 1;
        } catch (err) {}
      }
    }
    return count;
  }

  function close() {
    clearInterval(heartbeat);
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch (err) {}
    }
    wss.close();
  }

  return {
    mode: 'ws',
    broadcast,
    close,
    get clientCount() {
      return wss.clients.size;
    }
  };
}

// ---------------------------------------------------------------- 内置最小实现

function setupFallback(server) {
  const clients = new Set();

  server.on('upgrade', (req, socket) => {
    const pathname = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    if (pathname !== WS_PATH || !key) {
      socket.destroy();
      return;
    }

    // RFC6455 握手
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    const client = { socket, buffer: Buffer.alloc(0) };
    clients.add(client);
    sendText(client, {
      type: 'connected',
      data: { message: '已连接厨房实时通道', online: clients.size },
      at: Date.now()
    });

    socket.on('data', (chunk) => handleData(client, chunk));
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  // 解析客户端帧：只处理 close / ping，文本帧忽略
  function handleData(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);

    while (client.buffer.length >= 2) {
      const buf = client.buffer;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) === 0x80;
      let length = buf[1] & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buf.length < 4) return;
        length = buf.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buf.length < 10) return;
        length = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLength = masked ? 4 : 0;
      if (buf.length < offset + maskLength + length) return;

      const mask = masked ? buf.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(buf.subarray(offset + maskLength, offset + maskLength + length));
      if (mask) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      client.buffer = buf.subarray(offset + maskLength + length);

      if (opcode === 0x8) {
        // close
        try {
          client.socket.end(Buffer.from([0x88, 0x00]));
        } catch (err) {}
        clients.delete(client);
        return;
      }
      if (opcode === 0x9) {
        // ping -> pong
        sendFrame(client.socket, 0xa, payload);
      }
    }
  }

  function sendFrame(socket, opcode, payload) {
    let header;
    const length = payload.length;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  function sendText(client, payload) {
    try {
      sendFrame(client.socket, 0x1, Buffer.from(JSON.stringify(payload)));
    } catch (err) {
      clients.delete(client);
    }
  }

  const heartbeat = setInterval(() => {
    for (const client of [...clients]) {
      sendFrame(client.socket, 0x9, Buffer.alloc(0));
    }
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  function broadcast(payload) {
    const text = JSON.stringify(payload);
    let count = 0;
    for (const client of [...clients]) {
      try {
        sendFrame(client.socket, 0x1, Buffer.from(text));
        count += 1;
      } catch (err) {
        clients.delete(client);
      }
    }
    return count;
  }

  function close() {
    clearInterval(heartbeat);
    for (const client of clients) {
      try {
        client.socket.destroy();
      } catch (err) {}
    }
    clients.clear();
  }

  return {
    mode: 'builtin',
    broadcast,
    close,
    get clientCount() {
      return clients.size;
    }
  };
}

module.exports = { setupWebSocket };
