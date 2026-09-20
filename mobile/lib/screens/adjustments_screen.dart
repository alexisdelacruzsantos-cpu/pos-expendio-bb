import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/models.dart';
import '../services/api_service.dart';

class AdjustmentsScreen extends StatefulWidget {
  const AdjustmentsScreen({super.key});

  @override
  State<AdjustmentsScreen> createState() => _AdjustmentsScreenState();
}

class _AdjustmentsScreenState extends State<AdjustmentsScreen> {
  final _api = ApiService();
  final _searchCtrl = TextEditingController();
  Future<List<Product>>? _future;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _load([String search = '']) {
    setState(() {
      _future = _api.getProducts(search: search);
    });
  }

  void _onSearch(String query) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _load(query));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ajustes de inventario')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _onSearch,
              decoration: InputDecoration(
                hintText: 'Buscar producto a ajustar',
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
          Expanded(
            child: FutureBuilder<List<Product>>(
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
                final products = snap.data!;
                if (products.isEmpty) {
                  return const Center(child: Text('Sin resultados'));
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  itemCount: products.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: 6),
                  itemBuilder: (context, index) {
                    final p = products[index];
                    return ListTile(
                      tileColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      title: Text(p.name,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(
                        p.barcode.isNotEmpty ? p.barcode : p.categoryName ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: const Icon(Icons.tune),
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                ProductAdjustmentScreen(productId: p.id),
                          ),
                        );
                      },
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class ProductAdjustmentScreen extends StatefulWidget {
  final int productId;

  const ProductAdjustmentScreen({super.key, required this.productId});

  @override
  State<ProductAdjustmentScreen> createState() =>
      _ProductAdjustmentScreenState();
}

class _ProductAdjustmentScreenState extends State<ProductAdjustmentScreen> {
  final _api = ApiService();

  final _adjustmentCtrl = TextEditingController();
  final _newQtyCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  final _costCtrl = TextEditingController();
  final _lotPriceCtrl = TextEditingController();
  final _reasonCtrl = TextEditingController();

  AdjustmentProduct? _product;
  bool _loading = true;
  String? _error;
  bool _saving = false;
  int _selectedLotId = 0;
  String _adjWarning = '';

  static final _adjPattern = RegExp(r'^([+-]?)(\d+(?:\.\d+)?)$');

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _adjustmentCtrl.dispose();
    _newQtyCtrl.dispose();
    _priceCtrl.dispose();
    _costCtrl.dispose();
    _lotPriceCtrl.dispose();
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final p = await _api.getAdjustmentProduct(widget.productId);
      if (!mounted) return;
      setState(() {
        _product = p;
        _loading = false;
        _fieldsFromProduct(p);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$e';
      });
    }
  }

  void _fieldsFromProduct(AdjustmentProduct p) {
    _priceCtrl.text = _fmtNum(p.price);
    _costCtrl.text = _fmtNum(p.cost);
    _adjustmentCtrl.text = '';
    _newQtyCtrl.text = '';
    _lotPriceCtrl.text = '';
    _reasonCtrl.clear();
    _adjWarning = '';
    _selectedLotId = 0;
  }

  String _fmtNum(double v) {
    if (v == v.roundToDouble()) {
      return v.toInt().toString();
    }
    return v.toStringAsFixed(2);
  }

  String _fmtQty(double v) {
    if (v == v.roundToDouble()) {
      return v.toInt().toString();
    }
    return v.toStringAsFixed(2);
  }

  double get _currentTarget {
    final lots = _product?.lots.where((l) => l.id != 0).toList() ?? [];
    final selectedLot = _selectedLot(lots, _selectedLotId);
    return selectedLot == null
        ? (_product?.productStock ?? 0)
        : selectedLot.currentQuantity;
  }

  void _onAdjustmentInput(String raw) {
    final text = raw.trim();
    final match = _adjPattern.firstMatch(text);
    if (match != null) {
      final sign = match.group(1) == '-' ? -1.0 : 1.0;
      final amount = double.parse(match.group(2)!);
      final adjustment = sign * amount;
      var next = _currentTarget + adjustment;
      if (next < 0) next = 0;
      _newQtyCtrl.text = _fmtQty(next);
      setState(() {
        _adjWarning = (next == 0 && adjustment < 0)
            ? 'El stock no puede ser negativo. Se ajustará a 0.'
            : '';
      });
    } else if (text.isNotEmpty) {
      _newQtyCtrl.text = '';
      setState(() => _adjWarning =
          'Ingresa una cantidad válida para el ajuste (sin signo = sumar).');
    } else {
      _newQtyCtrl.text = '';
      setState(() => _adjWarning = '');
    }
  }

  void _onNewQtyInput(String raw) {
    final newQty = double.tryParse(raw.trim().replaceAll(',', '.'));
    if (newQty == null) return;
    final diff = newQty - _currentTarget;
    _adjustmentCtrl.text = diff >= 0 ? '+${_fmtQty(diff)}' : _fmtQty(diff);
    setState(() => _adjWarning = '');
  }

  double? _parseAmount(String raw) {
    if (raw.trim().isEmpty) return null;
    return double.tryParse(raw.trim().replaceAll(',', '.'));
  }

  Future<void> _submit() async {
    final p = _product;
    if (p == null) return;

    final lots = p.lots.where((l) => l.id != 0).toList();
    final selectedLot = _selectedLot(lots, _selectedLotId);
    final targetQuantity =
        selectedLot == null ? p.productStock : selectedLot.currentQuantity;

    double? adjustment;
    final adjustRaw = _adjustmentCtrl.text.trim();
    if (adjustRaw.isNotEmpty) {
      final match = _adjPattern.firstMatch(adjustRaw);
      if (match == null) {
        _snack('Ingresa un ajuste válido (+/- cantidad)', isError: true);
        return;
      }
      final sign = match.group(1) == '-' ? -1.0 : 1.0;
      adjustment = sign * double.parse(match.group(2)!);
    }
    if (adjustment != null && !adjustment.isFinite) {
      _snack('Ingresa un ajuste válido (+/- cantidad)', isError: true);
      return;
    }

    double? newQuantity;
    final newQtyRaw = _newQtyCtrl.text.trim();
    if (newQtyRaw.isNotEmpty) {
      newQuantity = _parseAmount(newQtyRaw);
      if (newQuantity == null) {
        _snack('Cantidad inválida', isError: true);
        return;
      }
      if (newQuantity < 0) {
        _snack('La cantidad no puede ser negativa', isError: true);
        return;
      }
      adjustment ??= newQuantity - targetQuantity;
    }

    final newPrice = _parseAmount(_priceCtrl.text);
    if (_priceCtrl.text.trim().isNotEmpty && newPrice == null) {
      _snack('Precio inválido', isError: true);
      return;
    }
    if (newPrice != null && newPrice < 0) {
      _snack('El precio no puede ser negativo', isError: true);
      return;
    }

    final newCost = _parseAmount(_costCtrl.text);
    if (_costCtrl.text.trim().isNotEmpty && newCost == null) {
      _snack('Costo inválido', isError: true);
      return;
    }
    if (newCost != null && newCost < 0) {
      _snack('El costo no puede ser negativo', isError: true);
      return;
    }

    double? newLotPrice;
    if (selectedLot != null) {
      newLotPrice = _parseAmount(_lotPriceCtrl.text);
      if (_lotPriceCtrl.text.trim().isNotEmpty && newLotPrice == null) {
        _snack('Precio del lote inválido', isError: true);
        return;
      }
      if (newLotPrice != null && newLotPrice < 0) {
        _snack('El precio del lote no puede ser negativo', isError: true);
        return;
      }
    }

    final priceChanged = newPrice != null && newPrice != p.price;
    final costChanged = newCost != null && newCost != p.cost;
    final stockChanged =
        (newQuantity != null && newQuantity != targetQuantity) ||
            (adjustment != null && adjustment != 0);
    final lotPriceChanged = newLotPrice != null &&
        newLotPrice != (selectedLot?.salePrice ?? 0);

    if (!priceChanged && !costChanged && !stockChanged && !lotPriceChanged) {
      _snack('No hay cambios para guardar', isError: true);
      return;
    }

    setState(() => _saving = true);
    try {
      await _api.applyAdjustment(
        productId: p.id,
        lotId: selectedLot?.id,
        adjustment: stockChanged ? adjustment : null,
        newQuantity: stockChanged ? newQuantity : null,
        newPrice: priceChanged ? newPrice : null,
        newCost: costChanged ? newCost : null,
        newLotPrice: lotPriceChanged ? newLotPrice : null,
        reason: _reasonCtrl.text.trim(),
      );
      if (!mounted) return;
      _snack('Ajuste guardado correctamente');
      await _init();
      setState(() => _saving = false);
    } catch (e) {
      if (!mounted) return;
      _snack('$e', isError: true);
      setState(() => _saving = false);
    }
  }

  void _snack(String msg, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Colors.red[700] : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ajustar producto')),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _init,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );
    }
    final p = _product!;
    final money =
        NumberFormat.currency(locale: 'es_MX', symbol: r'$').format;
    final lots = p.lots.where((l) => l.id != 0).toList();
    final realLotsTotal =
        lots.fold<double>(0, (sum, l) => sum + l.currentQuantity);
    final selectedLot = _selectedLot(lots, _selectedLotId);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Card(
          color: Theme.of(context).colorScheme.primaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.name,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold)),
                if (p.barcode.isNotEmpty)
                  Text(p.barcode, style: Theme.of(context).textTheme.bodySmall),
                if (p.categoryName != null)
                  Text(p.categoryName!,
                      style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 8),
                Text(
                  'Existencias efectivas: '
                  '${(p.productStock + realLotsTotal).toStringAsFixed(0)}'
                  ' (general ${p.productStock.toStringAsFixed(0)}'
                  ' + lotes ${realLotsTotal.toStringAsFixed(0)})',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Ajustar a',
                    filled: true,
                    fillColor: Colors.white,
                    isDense: true,
                  ),
                  child: DropdownButton<int>(
                    value: _selectedLotId,
                    isExpanded: true,
                    underline: const SizedBox.shrink(),
                    items: [
                      const DropdownMenuItem(
                        value: 0,
                        child: Text('Stock general'),
                      ),
                      ...lots.map((l) => DropdownMenuItem(
                            value: l.id,
                            child: Text(
                              '${l.batchNumber}'
                              '${l.expiryDate != null ? ' · ${l.expiryDate!.substring(0, 10)}' : ''}'
                              ' · ${l.currentQuantity.toStringAsFixed(0)} uds',
                              overflow: TextOverflow.ellipsis,
                            ),
                          )),
                    ],
                    onChanged: lots.isEmpty
                        ? null
                        : (v) {
                            setState(() {
                              _selectedLotId = v ?? 0;
                              _adjustmentCtrl.text = '';
                              _newQtyCtrl.text = '';
                              _lotPriceCtrl.text = '';
                              _adjWarning = '';
                            });
                          },
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _adjustmentCtrl,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: 'Parámetro de ajuste',
                    hintText: 'Ej: +5 o -3 (sin signo = sumar)',
                    helperText:
                        'Cantidad actual: ${_fmtQty(_currentTarget)}',
                    prefixIcon: const Icon(Icons.exposure),
                    filled: true,
                    fillColor: Colors.white,
                    isDense: true,
                  ),
                  onChanged: _onAdjustmentInput,
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _newQtyCtrl,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Nueva cantidad (calculada)',
                    prefixIcon: Icon(Icons.calculate_outlined),
                    filled: true,
                    fillColor: Colors.white,
                    isDense: true,
                  ),
                  onChanged: _onNewQtyInput,
                ),
                if (_adjWarning.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _adjWarning,
                      style: TextStyle(
                        color: _adjWarning.contains('negativo')
                            ? Colors.orange[800]
                            : Colors.red[700],
                        fontSize: 12,
                      ),
                    ),
                  ),
                if (selectedLot != null && selectedLot.salePrice != null) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _lotPriceCtrl,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(
                      labelText:
                          'Precio del lote (${money(selectedLot.salePrice!)})',
                      prefixIcon: const Icon(Icons.price_change_outlined),
                      filled: true,
                      fillColor: Colors.white,
                      isDense: true,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                TextField(
                  controller: _priceCtrl,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: 'Precio de venta (${money(p.price)})',
                    prefixIcon: const Icon(Icons.sell_outlined),
                    filled: true,
                    fillColor: Colors.white,
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _costCtrl,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: 'Costo (${money(p.cost)})',
                    prefixIcon: const Icon(Icons.savings_outlined),
                    filled: true,
                    fillColor: Colors.white,
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _reasonCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Motivo (opcional)',
                    prefixIcon: Icon(Icons.notes),
                    filled: true,
                    fillColor: Colors.white,
                    isDense: true,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _saving ? null : _submit,
          icon: _saving
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.check),
          label: Text(_saving ? 'Guardando...' : 'Guardar ajuste'),
          style: FilledButton.styleFrom(padding: const EdgeInsets.all(16)),
        ),
      ],
    );
  }

  AdjustmentLot? _selectedLot(List<AdjustmentLot> lots, int lotId) {
    if (lotId == 0) return null;
    for (final l in lots) {
      if (l.id == lotId) return l;
    }
    return null;
  }
}