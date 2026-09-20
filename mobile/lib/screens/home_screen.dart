import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/server_selector.dart';
import 'reports_screen.dart';
import 'products_screen.dart';
import 'sales_history_screen.dart';
import 'adjustments_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final cloudMode = ApiService.isCloudMode();
    return Scaffold(
      appBar: AppBar(
        title: const Text('POS Expendio BB'),
        actions: [
          IconButton(
            icon: const Icon(Icons.dns_outlined),
            tooltip: 'Servidor: ${ApiService.baseUrl}',
            onPressed: () => showServerSelector(context),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Cerrar sesión',
            onPressed: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Cerrar sesión'),
                  content: const Text('¿Deseas salir?'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: const Text('Cancelar')),
                    FilledButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: const Text('Salir')),
                  ],
                ),
              );
              if (confirmed == true) auth.logout();
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (auth.user != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                'Bienvenido, ${auth.user!.fullName}',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: Colors.grey[700]),
              ),
            ),
          _DashboardCard(
            icon: Icons.bar_chart,
            title: 'Reportes de Ventas',
            subtitle: 'Resumen por día, categoría y cajero',
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const ReportsScreen())),
          ),
          _DashboardCard(
            icon: Icons.receipt_long_outlined,
            title: 'Historial de Ventas',
            subtitle: 'Consulta ventas, devoluciones y detalle',
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const SalesHistoryScreen())),
          ),
          _DashboardCard(
            icon: Icons.inventory_2_outlined,
            title: 'Productos',
            subtitle: 'Consulta catálogo, precios y stock',
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const ProductsScreen())),
          ),
          if (cloudMode)
            Card(
              color: Colors.orange.shade50,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Icon(Icons.lock_outline, color: Colors.orange.shade800),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Text(
                        'Modo nube (solo lectura). Los ajustes de inventario '
                        'se hacen en la tienda.',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            _DashboardCard(
              icon: Icons.tune,
              title: 'Ajustes de Inventario',
              subtitle: 'Corrige stock, precios y lotes',
              onTap: () => Navigator.push(context,
                  MaterialPageRoute(builder: (_) => const AdjustmentsScreen())),
            ),
        ],
      ),
    );
  }
}

class _DashboardCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _DashboardCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(icon, size: 40, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(subtitle,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Colors.grey[600])),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Colors.grey[400]),
            ],
          ),
        ),
      ),
    );
  }
}