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
    final artistStyle = theme.textTheme.bodyLarge;
    final albumStyle = theme.textTheme.bodyMedium;
    final trackStyle = theme.textTheme.bodySmall;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          _marqueeText(artist, artistStyle, true),
          const SizedBox(height: 8),
          _marqueeText((year.isNotEmpty) ? '$album - ($year)' : album, albumStyle, true),
          const SizedBox(height: 8),
          if (currentTrack != 0)
            LayoutBuilder(
              builder: (context, constraints) {
                final maxVisibleTracks = _calculateMaxVisibleTracks(constraints.maxHeight, trackStyle);
                final startIndex = (currentTrack - 1).clamp(0, tracks.length - 1);
                final remainingTracks = tracks.sublist(startIndex).take(maxVisibleTracks).toList().asMap();
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: remainingTracks.entries.map((entry) => _marqueeText(entry.value ?? '', trackStyle, (entry.key == 0))).toList(),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _marqueeText(String text, TextStyle? textStyle, bool canScroll) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final tp = TextPainter(
          text: TextSpan(text: text, style: textStyle),
          maxLines: 1,
          textDirection: TextDirection.ltr,
        )..layout(minWidth: 0, maxWidth: double.infinity);

        return SizedBox(
          height: textStyle?.fontSize != null ? textStyle!.fontSize! * 1.5 : 24,
          child: (canScroll && tp.width > constraints.maxWidth)
              ? Marquee(
                  text: text,
                  style: textStyle,
                  scrollAxis: Axis.horizontal,
                  blankSpace: 100.0,
                  velocity: 25.0,
                  startAfter: const Duration(seconds: 1),
                  fadingEdgeStartFraction: 0.05,
                  fadingEdgeEndFraction: 0.05,
                )
              : Text(
                   text, 
                   style: (!canScroll && textStyle.color != null) ? textStyle.copyWith(color: textStyle.color!.withOpacity(0.5)) : textStyle,
                ),
        );
      },
    );
  }

  int _calculateMaxVisibleTracks(double availableHeight, TextStyle textStyle) {
    final textPainter = TextPainter(
      text: TextSpan(text: 'Text', style: textStyle),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    
    final itemHeight = textPainter.height;
    final maxItems = (availableHeight / itemHeight).floor();
    
    textPainter.dispose();
    return maxItems;
  }
}
