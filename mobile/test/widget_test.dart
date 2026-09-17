import 'package:flutter_test/flutter_test.dart';

import 'package:pos_expendio_bb/main.dart';

void main() {
  testWidgets('App arranca sin crash', (WidgetTester tester) async {
    await tester.pumpWidget(const PosApp());
    await tester.pump();
    expect(find.byType(PosApp), findsOneWidget);
  });
}