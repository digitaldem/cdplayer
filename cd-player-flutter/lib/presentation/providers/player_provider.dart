import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';

import '../../core/dependency_injection';
import '../../core/display_sleep_manager';
import '../../data/models/album_info.dart';
import '../../data/models/player_status.dart';
import '../../domain/entities/ialbum_info.dart';
import '../../domain/entities/iplayer_status.dart';
import '../../networking/web_socket_client.dart';

class PlayerProvider extends ChangeNotifier {
  final _displayManager = DependencyInjection.resolve<DisplaySleepManager>();
  final WebSocketClient _socketClient;
  ConnectionStatus _socketStatus = ConnectionStatus.connecting;

  StreamSubscription<String>? _sub;
  StreamSubscription<ConnectionStatus>? _statusSub;

  IPlayerStatus? _playerStatus;
  IAlbumInfo? _albumInfo;

  ConnectionStatus get connectionStatus => _socketStatus;

  bool get hasDisc => _albumInfo != null && _albumInfo!.tracks.isNotEmpty;
  IAlbumInfo get albumInfo => _albumInfo ?? AlbumInfo(artist: 'No Disc', album: '', albumArt: '', year: '', tracks: List.empty());
  IPlayerStatus get playerStatus => _playerStatus ?? PlayerStatus(state: 'stopped', track: 0, time: '0:00');

  bool isWorking = false;
  bool get isPlaying => _playerStatus?.state == 'playing';
  bool get isStopped => _playerStatus?.state == 'stopped';

  int get _currentTrack => _playerStatus?.track ?? 0;
  int get _trackCount => _albumInfo?.tracks.length ?? 0;

  bool get canSkipToPrevious => hasDisc && !isWorking && _currentTrack > 1;
  bool get canSkipToNext => hasDisc && !isWorking && _currentTrack < _trackCount;
  bool get canPause => hasDisc && !isWorking && isPlaying;
  bool get canPlay => hasDisc && !isWorking && !isPlaying;
  bool get canStop => hasDisc && !isWorking && !isStopped;
  bool get canEject => hasDisc && !isWorking;
  bool get canRefresh => hasDisc && !isWorking;

  PlayerProvider({required WebSocketClient client}) : _socketClient = client {
    _sub = _socketClient.stream.listen(_handleIncoming, onError: (_) {}, onDone: () {}, cancelOnError: true);

    _statusSub = _socketClient.status.listen((s) {
      _socketStatus = s;
      notifyListeners();
    });
  }

  void _handleIncoming(String raw) {
    Map<String, dynamic>? decoded;
    try {
      final d = jsonDecode(raw);
      if (d is Map<String, dynamic>) {
        decoded = d;
      }
    } catch (_) {}

    if (decoded == null) {
      return;
    }

    final type = decoded['type']?.toString();
    switch (type) {
      case 'connect':
      case 'pong':
        {
          break;
        }

      case 'insert':
        {
          //notifyListeners();
          break;
        }

      case 'eject':
        {
          _playerStatus = null;
          _albumInfo = null;
          notifyListeners();
          break;
        }

      case 'info':
        {
          final albumInfo = AlbumInfo.fromJson(decoded['info']);
          if (albumInfo.discId != _albumInfo?.discId || albumInfo.artist != _albumInfo?.artist || albumInfo.album != _albumInfo?.album) {
            _albumInfo = albumInfo;
            notifyListeners();
          }
          break;
        }

      case 'status':
        {
          final playerStatus = PlayerStatus.fromJson(decoded['status']);
          if (playerStatus.state != _playerStatus?.state || playerStatus.track != _playerStatus?.track) {
            _playerStatus = playerStatus;
            if (_playerStatus.state == 'playing') {
              _displayManager.onPlaybackStarted();
            } else {
              _displayManager.onPlaybackStopped();
            }
            notifyListeners();
          }
          break;
        }

      default:
        if (isWorking) {
          isWorking = false;
          notifyListeners();
        }
        break;
    }
  }

  void eject() {
    _socketClient.send('eject');
  }

  void play() {
    _socketClient.send('play');
  }

  void pause() {
    _socketClient.send('pause');
  }

  void stop() {
    _socketClient.send('stop');
  }

  void next() {
    isWorking = true;
    notifyListeners();
    _socketClient.send('next');
  }

  void previous() {
    isWorking = true;
    notifyListeners();
    _socketClient.send('previous');
  }

  void refresh() {
    isWorking = true;
    notifyListeners();
    _socketClient.send('refresh');
  }

  void handleUserInteraction() {
    _displayManager.onUserInteraction();
  }

  @override
  void dispose() {
    _sub?.cancel();
    _statusSub?.cancel();
    super.dispose();
  }
}
