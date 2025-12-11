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
    final playerProvider = Provider.of<PlayerProvider>(context, listen: true);

    if (playerProvider.connectionStatus == ConnectionStatus.connected) {
      return Scaffold(
        appBar: null,
        body: SafeArea(child: Column(children: [Album(), PlaybackControls(), Spacer()])),
      );
    }

    return Center(child: CircularProgressIndicator());
  }
}
