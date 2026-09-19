import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/models.dart';
import '../services/api_service.dart';

class SalesHistoryScreen extends StatefulWidget {
  const SalesHistoryScreen({super.key});

  @override
  State<SalesHistoryScreen> createState() => _SalesHistoryScreenState();
}

class _SalesHistoryScreenState extends State<SalesHistoryScreen> {
  final _api = ApiService();
  final _searchCtrl = TextEditingController();
  Future<List<Sale>>? _future;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  String _status = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  void _load() {
    setState(() {
      _future = _api.getSalesHistory(
        dateFrom: _dateFrom == null
            ? null
            : DateFormat('yyyy-MM-dd').format(_dateFrom!),
        dateTo: _dateTo == null
            ? null
            : DateFormat('yyyy-MM-dd').format(_dateTo!),
        q: _searchCtrl.text.trim(),
        status: _status,
      );
    });
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final from = await showDatePicker(
      context: context,
      initialDate: _dateFrom ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
      helpText: 'Fecha desde',
    );
    if (from == null) return;
    if (!mounted) return;
    final to = await showDatePicker(
      context: context,
      initialDate: _dateTo ?? now,
      firstDate: from,
      lastDate: now,
      helpText: 'Fecha hasta',
    );
    if (to == null || !mounted) return;
    setState(() {
      _dateFrom = DateTime(from.year, from.month, from.day);
      _dateTo = DateTime(to.year, to.month, to.day);
    });
    _load();
  }

  Future<void> _clearRange() async {
    setState(() {
      _dateFrom = null;
      _dateTo = null;
    });
    _load();
  }

  String _rangeLabel() {
    if (_dateFrom == null) return 'Rango';
    return '${DateFormat('d/M').format(_dateFrom!)} - ${DateFormat('d/M').format(_dateTo!)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Historial de ventas'),
        actions: [
          IconButton(
            tooltip: 'Filtrar por fecha',
            icon: const Icon(Icons.date_range),
            onPressed: _pickRange,
          ),
          if (_dateFrom != null)
            IconButton(
              tooltip: 'Limpiar rango',
              icon: const Icon(Icons.clear),
              onPressed: _clearRange,
            ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: TextField(
              controller: _searchCtrl,
              onSubmitted: (_) => _load(),
              decoration: InputDecoration(
                hintText: 'Buscar por folio, producto o cliente',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchCtrl.clear();
                          _load();
                        },
                      )
                    : null,
                filled: true,
                fillColor: Colors.white,
                isDense: true,
              ),
            ),
          ),
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                _statusChip('', 'Todos'),
                _statusChip('active', 'Activas'),
                _statusChip('partial_return', 'Con devolución'),
                _statusChip('returned', 'Devueltas'),
                _statusChip('cancelled', 'Canceladas'),
              ],
            ),
          ),
          if (_dateFrom != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Período: ${_rangeLabel()}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w600),
                ),
              ),
            ),
          Expanded(
            child: FutureBuilder<List<Sale>>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('${snap.error}', textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed: _load,
                            icon: const Icon(Icons.refresh),
                            label: const Text('Reintentar'),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                final sales = snap.data!;
                if (sales.isEmpty) {
                  return const Center(child: Text('Sin ventas en este período'));
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(12),
                    itemCount: sales.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 6),
                    itemBuilder: (context, index) {
                      final sale = sales[index];
                      return _SaleCard(
                        sale: sale,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => SaleDetailScreen(
                                saleId: sale.id),
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusChip(String value, String label) {
    final selected = _status == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) {
          setState(() => _status = value);
          _load();
        },
      ),
    );
  }
}

class _SaleCard extends StatelessWidget {
  final Sale sale;
  final VoidCallback onTap;

  const _SaleCard({required this.sale, required this.onTap});

  String _methodLabel(String method) {
    switch (method) {
      case 'cash':
        return 'Efectivo';
      case 'card':
        return 'Tarjeta';
      case 'mixed':
        return 'Mixto';
      case 'transfer':
        return 'Transferencia';
      default:
        return method;
    }
  }

  @override
  Widget build(BuildContext context) {
    final money =
        NumberFormat.currency(locale: 'es_MX', symbol: r'$').format;
    final dt = DateTime.tryParse(sale.saleDate);
    final time = dt != null ? DateFormat('HH:mm').format(dt) : '';
    final date = dt != null ? DateFormat('d/M/y').format(dt) : '';

    final Color statusColor;
    switch (sale.status) {
      case 'returned':
        statusColor = Colors.blue;
        break;
      case 'partial_return':
        statusColor = Colors.orange;
        break;
      case 'cancelled':
        statusColor = Colors.red;
        break;
      default:
        statusColor = Colors.green;
    }

    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text('Venta #${sale.id}',
                            style: const TextStyle(
                                fontWeight: FontWeight.w600)),
                        const SizedBox(width: 8),
                        Text('$date $time',
                            style: Theme.of(context).textTheme.bodySmall),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: statusColor.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            sale.status == 'active'
                                ? 'Activa'
                                : sale.status == 'returned'
                                    ? 'Devuelta'
                                    : sale.status == 'partial_return'
                                        ? 'Devolución'
                                        : 'Cancelada',
                            style: TextStyle(
                                fontSize: 11,
                                color: statusColor,
                                fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('Cajero: ${sale.cashierName}',
                        style: Theme.of(context).textTheme.bodySmall),
                    Text(
                      '${_methodLabel(sale.paymentMethod)} · '
                      '${sale.itemCount} artículo(s)'
                      '${sale.returnedAmount > 0 ? ' · Devoluciones ${money(sale.returnedAmount)}' : ''}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Colors.grey[600]),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(money(sale.total),
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color:
                              Theme.of(context).colorScheme.primary)),
                  const SizedBox(height: 4),
                  Icon(Icons.chevron_right, color: Colors.grey[400]),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SaleDetailScreen extends StatefulWidget {
  final int saleId;

  const SaleDetailScreen({super.key, required this.saleId});

  @override
  State<SaleDetailScreen> createState() => _SaleDetailScreenState();
}

class _SaleDetailScreenState extends State<SaleDetailScreen> {
  final _api = ApiService();
  late Future<SaleDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.getSaleDetail(widget.saleId);
  }

  void _reload() {
    setState(() {
      _future = _api.getSaleDetail(widget.saleId);
    });
  }

  String _methodLabel(String method) {
    switch (method) {
      case 'cash':
        return 'Efectivo';
      case 'card':
        return 'Tarjeta';
      case 'mixed':
        return 'Efectivo + Tarjeta';
      case 'transfer':
        return 'Transferencia';
      default:
        return method;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Detalle de venta')),
      body: FutureBuilder<SaleDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('${snap.error}', textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _reload,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Reintentar'),
                    ),
                  ],
                ),
              ),
            );
          }
          final detail = snap.data!;
          final sale = detail.sale;
          final money =
              NumberFormat.currency(locale: 'es_MX', symbol: r'$').format;
          final totalReturned = detail.items.fold<double>(
              0, (sum, it) => sum + it.returnedAmount);
          final dt = DateTime.tryParse(sale.saleDate);
          final date = dt != null
              ? DateFormat("d 'de' MMMM 'de' y, HH:mm").format(dt)
              : sale.saleDate;

          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(12),
              children: [
                _DetailHeader(
                    sale: sale,
                    dateLabel: date,
                    methodLabel: _methodLabel(sale.paymentMethod),
                    returnedAmount: totalReturned),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: detail.items
                          .map((it) => _ItemRow(item: it, money: money))
                          .toList(),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        _TotalRow('Subtotal', money(sale.subtotal)),
                        if (sale.total < sale.subtotal)
                          _TotalRow('Descuento',
                              '-${money(sale.subtotal - sale.total)}'),
                        const Divider(height: 20),
                        _TotalRow('Total',
                            money(sale.total),
                            emphasized: true),
                        _TotalRow('Pago (${_methodLabel(sale.paymentMethod)})',
                            money(sale.amountTendered)),
                        if (sale.changeGiven > 0)
                          _TotalRow('Cambio', money(sale.changeGiven)),
                      ],
                    ),
                  ),
                ),
                if (sale.customerName != null || sale.notes != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (sale.customerName != null) ...[
                            Text('Cliente: ${sale.customerName}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600)),
                            const SizedBox(height: 4),
                          ],
                          if (sale.notes != null)
                            Text('Notas: ${sale.notes}'),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _DetailHeader extends StatelessWidget {
  final Sale sale;
  final String dateLabel;
  final String methodLabel;
  final double returnedAmount;

  const _DetailHeader({
    required this.sale,
    required this.dateLabel,
    required this.methodLabel,
    required this.returnedAmount,
  });

  @override
  Widget build(BuildContext context) {
    final Color statusColor;
    switch (sale.status) {
      case 'returned':
        statusColor = Colors.blue;
        break;
      case 'partial_return':
        statusColor = Colors.orange;
        break;
      case 'cancelled':
        statusColor = Colors.red;
        break;
      default:
        statusColor = Colors.green;
    }

    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Venta #${sale.id}',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const Spacer(),
                if (sale.status != 'active')
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: statusColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      sale.status == 'returned'
                          ? 'COMPLETAMENTE DEVUELTA'
                          : sale.status == 'partial_return'
                              ? 'DEVOLUCIÓN PARCIAL'
                              : 'CANCELADA',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(dateLabel),
            Text('Cajero: ${sale.cashierName}'),
            Text('Método: $methodLabel'),
            if (returnedAmount > 0)
              Text('Devuelto: ${returnedAmount.toStringAsFixed(2)}',
                  style: const TextStyle(
                      color: Colors.blue, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  final SaleItem item;
  final String Function(double) money;

  const _ItemRow({required this.item, required this.money});

  @override
  Widget build(BuildContext context) {
    final returned = item.returnedQuantity > 0;
    final available = item.quantity - item.returnedQuantity;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  item.productName,
                  style: TextStyle(
                      fontWeight: FontWeight.w600,
                      decoration:
                          returned ? TextDecoration.lineThrough : null),
                ),
              ),
              Text(money(item.total),
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
          Text(
            '${item.quantity.toStringAsFixed(0)} x ${money(item.unitPrice)}'
            '${item.batchNumber != null ? ' · Lote ${item.batchNumber}' : ''}',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Colors.grey[600]),
          ),
          if (item.discount > 0)
            Text('Descuento -${money(item.discount)}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.green[700])),
          if (returned)
            Text(
              'Devueltos ${item.returnedQuantity.toStringAsFixed(0)} · restan ${available.toStringAsFixed(0)}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Colors.orange[800], fontWeight: FontWeight.w600),
            ),
        ],
      ),
    );
  }
}

class _TotalRow extends StatelessWidget {
  final String label;
  final String value;
  final bool emphasized;

  const _TotalRow(this.label, this.value, {this.emphasized = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: emphasized
                  ? const TextStyle(fontWeight: FontWeight.bold)
                  : TextStyle(color: Colors.grey[700])),
          Text(value,
              style: TextStyle(
                  fontWeight: emphasized ? FontWeight.bold : FontWeight.w600,
                  fontSize: emphasized ? 18 : 14)),
        ],
      ),
    );
  }
}