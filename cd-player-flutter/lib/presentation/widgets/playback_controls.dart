import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/player_provider.dart';

class PlaybackControls extends StatelessWidget {
  const PlaybackControls({super.key});

  @override
  Widget build(BuildContext context) {
    final playerProvider = Provider.of<PlayerProvider>(context, listen: true);

    return Padding(
      padding: EdgeInsetsGeometry.only(top: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _iconButton(Icons.skip_previous, playerProvider.canSkipToPrevious ? () => playerProvider.previous() : null),
          if (!playerProvider.hasDisc || playerProvider.isWorking) _iconButton(Icons.play_arrow, null),
          if (playerProvider.canPlay) _iconButton(Icons.play_arrow, () => playerProvider.play()),
          if (playerProvider.canPause) _iconButton(Icons.pause, () => playerProvider.pause()),
          _iconButton(Icons.skip_next, playerProvider.canSkipToNext ? () => playerProvider.next() : null),
          _iconButton(Icons.stop, playerProvider.canStop ? () => playerProvider.stop() : null),
          _iconButton(Icons.eject, playerProvider.canEject ? () => playerProvider.eject() : null),
          _iconButton(Icons.refresh, playerProvider.canRefresh ? () => playerProvider.refresh() : null),
        ],
      ),
    );
  }

  Widget _iconButton(IconData icon, VoidCallback? onPressed) {
    return IconButton(icon: Icon(icon), iconSize: 40, onPressed: onPressed);
  }
}
