import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

class AlbumArt extends StatelessWidget {
  final String albumArtUrl;
  final double size;
  const AlbumArt({super.key, required this.albumArtUrl, required this.size});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Center(
        child:
            albumArtUrl.isNotEmpty
                ? CachedNetworkImage(
                  imageUrl: albumArtUrl,
                  width: size,
                  height: size,
                  fit: BoxFit.fill,
                  errorWidget: (context, url, error) => Icon(Icons.error_outline, size: size * .5),
                )
                : Icon(Icons.album, size: size * .75),
      ),
    );
  }
}
