import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/models.dart';
import '../services/api_service.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  final _api = ApiService();
  Future<SalesReport>? _future;
  late DateTime _date;

  @override
  void initState() {
    super.initState();
    _date = DateTime.now();
    _load();
  }

  void _load() {
    final day = DateFormat('yyyy-MM-dd').format(_date);
    setState(() {
      _future = _api.getSalesReport(
        dateFrom: day,
        dateTo: day,
        limit: 10,
      );
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
      helpText: 'Selecciona la fecha',
    );
    if (picked == null || !mounted) return;
    setState(() {
      _date = DateTime(picked.year, picked.month, picked.day);
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reporte de Ventas'),
        actions: [
          TextButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.date_range, color: Colors.white),
            label: Text(
              'Fecha: ${DateFormat('d/M/y').format(_date)}',
              style: const TextStyle(color: Colors.white),
            ),
          ),
        ],
      ),
      body: FutureBuilder<SalesReport>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return _ErrorView(
              message: '${snap.error}',
              onRetry: _load,
            );
          }
          final report = snap.data!;
          final s = report.summary;
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(12),
              children: [
                Row(
                  children: [
                    _MetricCard(
                        label: 'Ventas', value: '${s.sales}',
                        icon: Icons.receipt_long, color: Colors.blue),
                    _MetricCard(
                        label: 'Total', value: _money(s.total),
                        icon: Icons.payments, color: Colors.green),
                  ],
                ),
                Row(
                  children: [
                    _MetricCard(
                        label: 'Ticket prom.', value: _money(s.avgTicket),
                        icon: Icons.local_convenience_store, color: Colors.orange),
                    _MetricCard(
                        label: 'Unidades', value: '${s.units}',
                        icon: Icons.shopping_basket, color: Colors.purple),
                  ],
                ),
                _SectionCard(
                  title: 'Resumen',
                  child: Column(
                    children: [
                      _Row('Total', _money(s.total)),
                      _Row('Ticket promedio', _money(s.avgTicket)),
                      _Row('Ticket máximo', _money(s.maxTicket)),
                      _Row('Utilidad', _money(s.profit)),
                      _Row('Margen', '${s.marginPct}%'),
                    ],
                  ),
                ),
                if (report.payments.isNotEmpty)
                  _SectionCard(
                    title: 'Métodos de pago',
                    child: Column(
                      children: report.payments
                          .map((p) => _Row(_methodLabel(p.method), _money(p.amount)))
                          .toList(),
                    ),
                  ),
                if (report.topProducts.isNotEmpty)
                  _SectionCard(
                    title: 'Top productos',
                    child: Column(
                      children: report.topProducts
                          .take(5)
                          .map((p) => ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                leading: const Icon(Icons.production_quantity_limits),
                                title: Text(p.name),
                                subtitle: Text('${p.quantity} uds'),
                                trailing: Text(_money(p.revenue),
                                    style: const TextStyle(fontWeight: FontWeight.w600)),
                              ))
                          .toList(),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  String _money(double v) =>
      NumberFormat.currency(locale: 'es_MX', symbol: r'$').format(v);

  String _methodLabel(String method) {
    switch (method) {
      case 'cash':
        return 'Efectivo';
      case 'card':
        return 'Tarjeta';
      case 'transfer':
        return 'Transferencia';
      default:
        return method;
    }
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        margin: const EdgeInsets.all(4),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: color),
              const SizedBox(height: 8),
              Text(value,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold)),
              Text(label,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Colors.grey[600])),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;

  const _SectionCard({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600)),
            const Divider(height: 16),
            child,
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;

  const _Row(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[700])),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}