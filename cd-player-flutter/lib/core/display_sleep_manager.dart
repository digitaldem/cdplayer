import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

class DisplaySleepManager {
  Timer? _timer;
  bool _isManuallySet = false;
  final Duration timeout;
  
  DisplaySleepManager({required this.timeout});
  
  void onPlaybackStarted() {
    _cancelTimer();
    _wakeScreen();
    _disableAutoSleep();
  }
  
  void onPlaybackStopped() {
    _enableAutoSleep();
    _startTimer();
  }
  
  void _startTimer() {
    _cancelTimer();
    _timer = Timer(timeout, () => _sleepScreen());
  }
  
  void _cancelTimer() {
    _timer?.cancel();
    _timer = null;
  }
  
  Future<void> _disableAutoSleep() async {
    try {
      await Process.run('xset', ['s', 'off']);
      await Process.run('xset', ['-dpms']);
      await Process.run('xset', ['s', 'noblank']);
    } catch (e) {
      debugPrint('Failed to disable auto-sleep: $e');
    }
  }
  
  Future<void> _enableAutoSleep() async {
    try {
      await Process.run('xset', ['+dpms']);
    } catch (e) {
      debugPrint('Failed to enable auto-sleep: $e');
    }
  }
  
  Future<void> _sleepScreen() async {
    _isManuallySet = true;
    try {
      await Process.run('xset', ['dpms', 'force', 'off']);
    } catch (e) {
      debugPrint('Failed to sleep screen: $e');
    }
  }
  
  Future<void> _wakeScreen() async {
    if (_isManuallySet) {
      _isManuallySet = false;
      try {
        await Process.run('xset', ['dpms', 'force', 'on']);
      } catch (e) {
        debugPrint('Failed to wake screen: $e');
      }
    }
  }
  
  void onUserInteraction() {
    _wakeScreen();
    _startTimer();
  }
  
  void dispose() {
    _cancelTimer();
  }
}
