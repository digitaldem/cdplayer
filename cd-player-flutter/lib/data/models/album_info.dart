import 'package:freezed_annotation/freezed_annotation.dart';

import '../../domain/entities/ialbum_info.dart';

part 'album_info.freezed.dart';
part 'album_info.g.dart';

@freezed
sealed class AlbumInfo with _$AlbumInfo implements IAlbumInfo {
  const factory AlbumInfo({
    @Default('') String discId,
    @Default('') String? artist,
    @Default('') String? album,
    @Default('') String? albumArt,
    @Default('') String? year,
    @Default([]) List<String?> tracks,
  }) = _AlbumInfo;

  factory AlbumInfo.fromJson(Map<String, dynamic> json) => _$AlbumInfoFromJson(json);
}
