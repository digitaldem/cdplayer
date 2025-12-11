import 'package:flutter/material.dart';
import 'package:marquee/marquee.dart';

class AlbumInfo extends StatelessWidget {
  final String artist;
  final String album;
  final String year;
  final List<String?> tracks;
  final int currentTrack;
  const AlbumInfo({super.key, required this.artist, required this.album, required this.year, required this.tracks, required this.currentTrack});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          _marqueeText(artist, theme.textTheme.bodyLarge),
          const SizedBox(height: 4),
          _marqueeText((year.isNotEmpty) ? '$album - ($year)' : album, theme.textTheme.bodyMedium),
          const SizedBox(height: 4),
          if (currentTrack > 0 && currentTrack <= tracks.length) _marqueeText(tracks[currentTrack - 1] ?? '', theme.textTheme.bodySmall),
        ],
      ),
    );
  }

  Widget _marqueeText(String text, TextStyle? style) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final tp = TextPainter(
          text: TextSpan(text: text, style: style),
          maxLines: 1,
          textDirection: TextDirection.ltr,
        )..layout(minWidth: 0, maxWidth: double.infinity);

        return SizedBox(
          height: style?.fontSize != null ? style!.fontSize! * 1.5 : 24,
          child: (tp.width > constraints.maxWidth)
              ? Marquee(
                  text: text,
                  style: style,
                  scrollAxis: Axis.horizontal,
                  blankSpace: 100.0,
                  velocity: 25.0,
                  startAfter: const Duration(seconds: 1),
                  fadingEdgeStartFraction: 0.05,
                  fadingEdgeEndFraction: 0.05,
                )
              : Text(text, style: style),
        );
      },
    );
  }
}
