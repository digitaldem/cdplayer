import 'package:flutter/foundation.dart';
import 'package:logger/logger.dart';

class SimpleLogger extends Logger {
  SimpleLogger() : super(printer: _CustomSimplePrinter(), filter: _CustomLogFilter()) {
    i('Launch');
  }
}

class _CustomSimplePrinter extends SimplePrinter {
  _CustomSimplePrinter() : super(printTime: true, colors: true);
}

class _CustomLogFilter extends LogFilter {
  @override
  bool shouldLog(LogEvent event) {
    if (event.level == Level.info) {
      return true;
    }
    if (event.level == Level.debug) {
      return kDebugMode;
    }

    return event.level.index >= Level.warning.index;
  }
}
