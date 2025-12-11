import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

enum ConnectionStatus { connected, disconnected, connecting }

class WebSocketClient {
  final Uri _uri;
  late WebSocketChannel _channel;

  final _incomingController = StreamController<String>.broadcast();
  final _statusController = StreamController<ConnectionStatus>.broadcast();
  final List<String> _outgoingQueue = [];

  Timer? _reconnectTimer;
  int _retries = 0;
  bool _disposed = false;
  Timer? _pingTimer;
  Duration heartbeat = const Duration(seconds: 20);
  final Duration _reconnectBase = const Duration(seconds: 2);
  final _rng = Random();

  WebSocketClient._(this._uri) {
    _connect();
  }

  factory WebSocketClient.build(String url) => WebSocketClient._(Uri.parse(url));

  Stream<String> get stream => _incomingController.stream;
  Stream<ConnectionStatus> get status => _statusController.stream;

  void send(String command, [Map<String, dynamic>? payload]) {
    final message = jsonEncode({'action': command, ...?payload});
    debugPrint('WS: -> $message');
    try {
      _channel.sink.add(message);
    } catch (_) {
      _bufferAndReconnect(message);
    }
  }

  void _connect() {
    if (_disposed) {
      return;
    }
    _setStatus(ConnectionStatus.connecting);

    try {
      _channel = WebSocketChannel.connect(_uri);

      _channel.stream.listen(
        (message) {
          if (message is String) {
            debugPrint('WS: <- $message');
            _incomingController.add(message);
          }
        },
        onError: (error) {
          _handleDisconnect();
        },
        onDone: () => _handleDisconnect(),
        cancelOnError: false,
      );

      _channel.ready
          .then((_) {
            _flushOutgoing();
            _startHeartbeat();
            _retries = 0;
            _setStatus(ConnectionStatus.connected);
          })
          .catchError((error) {
            _scheduleReconnect();
          });
    } catch (error) {
      _scheduleReconnect();
    }
  }

  void _handleDisconnect() {
    _stopHeartbeat();
    _setStatus(ConnectionStatus.disconnected);
    _scheduleReconnect();
  }

  void _bufferAndReconnect(String message) {
    _outgoingQueue.add(message);
    _handleDisconnect();
  }

  void _flushOutgoing() {
    while (_outgoingQueue.isNotEmpty) {
      final msg = _outgoingQueue.first;
      try {
        _channel.sink.add(msg);
        _outgoingQueue.removeAt(0);
      } catch (_) {
        // Stop flushing
        break;
      }
    }
  }

  void _scheduleReconnect() {
    if (_disposed || _reconnectTimer != null) {
      return;
    }

    final baseMs = _reconnectBase.inMilliseconds;
    final delayMs = (baseMs * pow(2, _retries)).toInt().clamp(1000, 30000);
    final jitterMs = _rng.nextInt(500);
    _retries++;

    _reconnectTimer = Timer(Duration(milliseconds: delayMs + jitterMs), () {
      _reconnectTimer = null;
      if (!_disposed) {
        _connect();
      }
    });
  }

  void _startHeartbeat() {
    _stopHeartbeat();
    _pingTimer = Timer.periodic(heartbeat, (_) {
      try {
        final ping = jsonEncode({'action': 'ping'});
        debugPrint('WS: -> $ping');
        _channel.sink.add(ping);
      } catch (_) {
        _handleDisconnect();
      }
    });
  }

  void _stopHeartbeat() {
    _pingTimer?.cancel();
    _pingTimer = null;
  }

  void _setStatus(ConnectionStatus status) {
    debugPrint('WS: $status');
    if (!_statusController.isClosed) {
      _statusController.add(status);
    }
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _stopHeartbeat();
    try {
      _channel.sink.close();
    } catch (_) {}
    _incomingController.close();
    _statusController.close();
  }
}
