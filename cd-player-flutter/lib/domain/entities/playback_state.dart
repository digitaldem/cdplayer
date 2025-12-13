enum PlaybackState {
  playing,
  paused,
  stopped;
  
  String get value {
    switch (this) {
      case PlaybackState.playing:
        return 'playing';
      case PlaybackState.paused:
        return 'paused';
      case PlaybackState.stopped:
        return 'stopped';
    }
  }
}
