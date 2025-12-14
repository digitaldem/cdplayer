import 'package:flutter/material.dart';
import 'package:marquee/marquee.dart';

class AlbumInfo extends StatelessWidget {
  final String artist;
  final String album;
  final String year;
  final List<String?> tracks;
  final int currentTrack;

  String get albumWithYear => year.isNotEmpty ? '$album ($year)' : album;

  const AlbumInfo({
    super.key,
    required this.artist,
    required this.album,
    required this.year,
    required this.tracks,
    required this.currentTrack,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final artistStyle = theme.textTheme.bodyLarge;
    final albumStyle = theme.textTheme.bodyMedium;
    final trackStyle = theme.textTheme.bodySmall;
    final dimTrackStyle = trackStyle?.copyWith(color: (trackStyle?.color ?? theme.colorScheme.primary).withOpacity(0.5));

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          _MarqueeText(
            text: artist,
            style: artistStyle,
          ),
          const SizedBox(height: 8),
          _MarqueeText(
            text: albumWithYear,
            style: albumStyle,
          ),
          const SizedBox(height: 16),
          if (currentTrack > 0)
            Expanded(
              child: _TrackList(
                tracks: tracks,
                currentTrack: currentTrack,
                textStyle: trackStyle,
                dimTextStyle: dimTrackStyle,
              ),
            ),
        ],
      ),
    );
  }
}

class _TrackList extends StatelessWidget {
  final List<String?> tracks;
  final int currentTrack;
  final TextStyle? textStyle;
  final TextStyle? dimTextStyle;

  const _TrackList({
    required this.tracks,
    required this.currentTrack,
    required this.textStyle,
    required this.dimTextStyle,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxVisibleTracks = _calculateMaxVisibleTracks(constraints.maxHeight);
        final visibleTracks = _getVisibleTracks(maxVisibleTracks);

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: visibleTracks.indexed.map((record) {
            final (index, track) = (record.$1, record.$2);
            return _MarqueeText(
              text: track ?? '',
              style: index == 0 ? textStyle : dimTextStyle,
            );
          }).toList(),
        );
      },
    );
  }

  List<String?> _getVisibleTracks(int maxCount) {
    final startIndex = (currentTrack - 1).clamp(0, tracks.length);
    return tracks.skip(startIndex).take(maxCount).toList();
  }

  int _calculateMaxVisibleTracks(double availableHeight) {
    if (availableHeight <= 0 || textStyle?.fontSize == null) {
      return 0;
    }

    final itemHeight = (textStyle!.fontSize! * 1.5);
    return (availableHeight / itemHeight).floor();
  }
}

class _MarqueeText extends StatelessWidget {
  final String text;
  final TextStyle? style;

  const _MarqueeText({
    required this.text,
    required this.style,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final textOverflows = _textExceedsWidth(constraints.maxWidth);

        return SizedBox(
          height: style?.fontSize != null ? style!.fontSize! * 1.5 : 24.0,
          child: (textOverflows)
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
              : Text(
                  text,
                  style: style,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
        );
      },
    );
  }

  bool _textExceedsWidth(double maxWidth) {
    final textPainter = TextPainter(
      text: TextSpan(text: text, style: style),
      maxLines: 1,
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: double.infinity);

    final exceedsWidth = textPainter.width > maxWidth;
    textPainter.dispose();
    return exceedsWidth;
  }
}
