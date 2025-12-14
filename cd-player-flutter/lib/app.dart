import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import './networking/web_socket_client.dart';
import './presentation/providers/player_provider.dart';
import './presentation/widgets/playback_controls.dart';
import './presentation/widgets/album.dart';

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final playerProvider = Provider.of<PlayerProvider>(context, listen: true);

    if (playerProvider.connectionStatus == ConnectionStatus.connected) {
      return Scaffold(
        appBar: null,
        body: SafeArea(
          child: GestureDetector(
            onTap: () => playerProvider.handleUserInteraction(),
            behavior: HitTestBehavior.translucent,
            child: Column(
              children: [
                Album(),
                Container(height: 2, width: double.infinity, color: theme.colorScheme.secondary),

                PlaybackControls(),
                Spacer(),
              ],
            ),
          ),
        ),
      );
    }

    return Center(child: CircularProgressIndicator());
  }
}
