import 'package:freezed_annotation/freezed_annotation.dart';

import '../../domain/entities/iplayer_status.dart';

part 'player_status.freezed.dart';
part 'player_status.g.dart';

@freezed
sealed class PlayerStatus with _$PlayerStatus implements IPlayerStatus {
  const factory PlayerStatus({required String state, required int track, required String time}) = _PlayerStatus;

  factory PlayerStatus.fromJson(Map<String, dynamic> json) => _$PlayerStatusFromJson(json);
}
