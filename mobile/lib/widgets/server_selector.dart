import 'package:flutter/material.dart';
import '../services/api_service.dart';

const kServerPresets = <String, String>{
  'Tienda (192.168.1.8)': kStoreBaseUrl,
  'Nube (PythonAnywhere)': kCloudBaseUrl,
  'Local (pruebas)': 'http://localhost:5000/api',
};

/// Muestra el selector de servidor y guarda la selección en
/// SharedPreferences vía [ApiService.setBaseUrl].
/// Devuelve la URL elegida o `null` si se canceló.
Future<String?> showServerSelector(BuildContext context) async {
  final url = await showDialog<String>(
    context: context,
    builder: (_) => const _ServerSelectorDialog(),
  );
  if (url != null && url.isNotEmpty) {
    await ApiService.setBaseUrl(url);
  }
  return url;
}

class _ServerSelectorDialog extends StatefulWidget {
  const _ServerSelectorDialog();

  @override
  State<_ServerSelectorDialog> createState() => _ServerSelectorDialogState();
}

class _ServerSelectorDialogState extends State<_ServerSelectorDialog> {
  final _customCtrl = TextEditingController();
  late final List<String> _presetKeys = kServerPresets.keys.toList();
  late int _mode;

  static const int _customIndex = 999;

  @override
  void initState() {
    super.initState();
    final current = ApiService.baseUrl;
    final presetIndex =
        _presetKeys.indexWhere((k) => kServerPresets[k] == current);
    _customCtrl.text = current;
    _mode = presetIndex >= 0 ? presetIndex : _customIndex;
  }

  @override
  void dispose() {
    _customCtrl.dispose();
    super.dispose();
  }

  String get _selectedUrl {
    if (_mode == _customIndex) {
      return _customCtrl.text.trim();
    }
    return kServerPresets[_presetKeys[_mode]] ?? kServerPresets.values.first;
  }

  void _confirm() {
    final url = _selectedUrl;
    if (url.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Escribe una dirección válida'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    Navigator.pop(context, url);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Servidor de datos'),
      content: SizedBox(
        width: 360,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
const Text(
                        'Elige a qué servidor apunta la app. En la nube '
                        '(https) es SOLO lectura: los cambios se hacen en la tienda.',
                        style: TextStyle(color: Colors.grey, fontSize: 12),
                      ),
              RadioGroup<int>(
                groupValue: _mode,
                onChanged: (v) => setState(() => _mode = v ?? _mode),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (var i = 0; i < _presetKeys.length; i++)
                      RadioListTile<int>(
                        value: i,
                        dense: true,
                        title: Text(_presetKeys[i]),
                        subtitle: Text(
                          kServerPresets[_presetKeys[i]]!,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    const RadioListTile<int>(
                      value: _customIndex,
                      dense: true,
                      title: Text('Personalizado'),
                      subtitle: Text('Escribe la URL del servidor'),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: TextField(
                  controller: _customCtrl,
                  enabled: _mode == _customIndex,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                    hintText: 'https://<tu-cuenta>.pythonanywhere.com/api',
                    prefixIcon: Icon(Icons.dns_outlined),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Actualmente: ${ApiService.baseUrl}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          onPressed: _confirm,
          icon: const Icon(Icons.check),
          label: const Text('Guardar'),
        ),
      ],
    );
  }
}