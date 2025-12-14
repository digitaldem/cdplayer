import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/player_provider.dart';
import './album_art.dart';
import './album_info.dart';

class Album extends StatelessWidget {
  static const double size = 400.0;

  const Album({super.key});

  @override
  Widget build(BuildContext context) {
    final playerProvider = Provider.of<PlayerProvider>(context, listen: true);
    final albumInfo = playerProvider.albumInfo;
    final playerStatus = playerProvider.playerStatus;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: AlbumArt(albumArtUrl: albumInfo.albumArt ?? '', size: size)),
        Expanded(
          child: AlbumInfo(
            artist: albumInfo.artist ?? '',
            album: albumInfo.album ?? '',
            year: albumInfo.year ?? '',
            tracks: albumInfo.tracks,
            currentTrack: playerStatus.track,
            size: size,
          ),
        ),
      ],
    );
  }
}
