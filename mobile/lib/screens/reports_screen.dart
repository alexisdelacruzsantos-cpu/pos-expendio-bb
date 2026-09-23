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
  String? _department;
  List<String> _departments = [];

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
        department: _department,
      ).then((report) {
        if (_department == null) {
          _departments =
              report.byDepartment.map((d) => d.department).toList();
        }
        return report;
      });
    });
  }

  void _selectDepartment(String? dept) {
    setState(() => _department = dept);
    _load();
  }

  /// Con un departamento elegido, el API resume el TOTAL con los tickets
  /// completos que contienen ese departamento (p.ej. Barcel $552), mientras que
  /// el detalle por departamento (by_department) trae SOLO la línea de ese
  /// departamento ($329). Para que la vista detalle coincida con el listado,
  /// se usa el resumen línea-proporcional del propio departamento.
  SalesSummary _effectiveSummary(SalesReport report) {
    final dept = _department;
    if (dept == null) return report.summary;
    final row = report.byDepartment.firstWhere(
      (d) => d.department == dept,
      orElse: () => DepartmentSummary(
        department: dept,
        sales: 0,
        units: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      ),
    );
    final total = row.revenue;
    return SalesSummary(
      sales: row.sales,
      total: total,
      avgTicket: row.sales > 0 ? total / row.sales : 0,
      maxTicket: 0,
      units: row.units,
      profit: row.profit,
      marginPct: total > 0 ? row.profit / total * 100 : 0,
    );
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
          final s = _effectiveSummary(report);
          final dept = _department;
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(12),
              children: [
                if (_departments.isNotEmpty)
                  Card(
                    child: Padding(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      child: DropdownButtonFormField<String?>(
                        initialValue: _department,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Departamento',
                          prefixIcon: Icon(Icons.category_outlined),
                          isDense: true,
                        ),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Todos los departamentos'),
                          ),
                          ..._departments
                              .map((d) => DropdownMenuItem<String?>(
                                    value: d,
                                    child:
                                        Text(d, overflow: TextOverflow.ellipsis),
                                  ))
                              .toList(),
                        ],
                        onChanged: _selectDepartment,
                      ),
                    ),
                  ),
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
                      _Row('Ticket máximo', dept == null ? _money(s.maxTicket) : '—'),
                      _Row('Utilidad', _money(s.profit)),
                      _Row('Margen', '${s.marginPct}%'),
                    ],
                  ),
                ),
                if (dept == null && report.payments.isNotEmpty)
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
                if (dept == null && report.byDepartment.isNotEmpty)
                  _SectionCard(
                    title: 'Por departamento (toca para filtrar)',
                    child: Column(
                      children: report.byDepartment
                          .map((d) => InkWell(
                                borderRadius: BorderRadius.circular(8),
                                onTap: () => _selectDepartment(d.department),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: 8, horizontal: 4),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.spaceBetween,
                                        children: [
                                          Expanded(
                                            child: Text(
                                              d.department,
                                              style: const TextStyle(
                                                  fontWeight: FontWeight.w600),
                                            ),
                                          ),
                                          Text(
                                            _money(d.revenue),
                                            style: const TextStyle(
                                                fontWeight: FontWeight.bold),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        '${d.sales} ventas · ${d.units} uds · utilidad ${_money(d.profit)}',
                                        style: TextStyle(
                                            color: Colors.grey[600],
                                            fontSize: 12),
                                      ),
                                    ],
                                  ),
                                ),
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