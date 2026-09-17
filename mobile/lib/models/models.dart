class User {
  final int id;
  final String username;
  final String fullName;
  final String role;

  User({required this.id, required this.username, required this.fullName, required this.role});

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as int,
      username: json['username'] as String,
      fullName: json['full_name'] as String? ?? '',
      role: json['role'] as String? ?? '',
    );
  }
}

class SalesSummary {
  final int sales;
  final double total;
  final double avgTicket;
  final double maxTicket;
  final int units;
  final double profit;
  final double marginPct;

  SalesSummary({
    required this.sales,
    required this.total,
    required this.avgTicket,
    required this.maxTicket,
    required this.units,
    required this.profit,
    required this.marginPct,
  });

  factory SalesSummary.fromJson(Map<String, dynamic> json) {
    return SalesSummary(
      sales: json['sales'] as int,
      total: (json['total'] as num).toDouble(),
      avgTicket: (json['avg_ticket'] as num).toDouble(),
      maxTicket: (json['max_ticket'] as num).toDouble(),
      units: json['units'] as int,
      profit: (json['profit'] as num).toDouble(),
      marginPct: (json['margin_pct'] as num).toDouble(),
    );
  }
}

class PaymentBreakdown {
  final String method;
  final int count;
  final double amount;

  PaymentBreakdown({required this.method, required this.count, required this.amount});

  factory PaymentBreakdown.fromJson(Map<String, dynamic> json) {
    return PaymentBreakdown(
      method: json['payment_method'] as String,
      count: json['count'] as int,
      amount: (json['amount'] as num).toDouble(),
    );
  }
}

class CashierSummary {
  final int cashierId;
  final String name;
  final int sales;
  final double amount;

  CashierSummary({
    required this.cashierId,
    required this.name,
    required this.sales,
    required this.amount,
  });

  factory CashierSummary.fromJson(Map<String, dynamic> json) {
    return CashierSummary(
      cashierId: json['cashier_id'] as int,
      name: json['cashier_name'] as String,
      sales: json['sales'] as int,
      amount: (json['amount'] as num).toDouble(),
    );
  }
}

class TopProduct {
  final String name;
  final String barcode;
  final String? categoryName;
  final int quantity;
  final double revenue;
  final double cost;
  final double profit;

  TopProduct({
    required this.name,
    required this.barcode,
    this.categoryName,
    required this.quantity,
    required this.revenue,
    required this.cost,
    required this.profit,
  });

  factory TopProduct.fromJson(Map<String, dynamic> json) {
    return TopProduct(
      name: json['name'] as String,
      barcode: json['barcode'] as String? ?? '',
      categoryName: json['category_name'] as String?,
      quantity: json['quantity'] as int,
      revenue: (json['revenue'] as num).toDouble(),
      cost: (json['cost'] as num).toDouble(),
      profit: (json['profit'] as num).toDouble(),
    );
  }
}

class DepartmentSummary {
  final String department;
  final int sales;
  final int units;
  final double revenue;
  final double cost;
  final double profit;

  DepartmentSummary({
    required this.department,
    required this.sales,
    required this.units,
    required this.revenue,
    required this.cost,
    required this.profit,
  });

  factory DepartmentSummary.fromJson(Map<String, dynamic> json) {
    return DepartmentSummary(
      department: json['department'] as String,
      sales: json['sales'] as int,
      units: json['units'] as int,
      revenue: (json['revenue'] as num).toDouble(),
      cost: (json['cost'] as num).toDouble(),
      profit: (json['profit'] as num).toDouble(),
    );
  }
}

class DaySummary {
  final String day;
  final int sales;
  final int units;
  final double total;

  DaySummary({
    required this.day,
    required this.sales,
    required this.units,
    required this.total,
  });

  factory DaySummary.fromJson(Map<String, dynamic> json) {
    return DaySummary(
      day: json['day'] as String,
      sales: json['sales'] as int,
      units: json['units'] as int,
      total: (json['total'] as num).toDouble(),
    );
  }
}

class SalesReport {
  final SalesSummary summary;
  final List<PaymentBreakdown> payments;
  final List<CashierSummary> cashiers;
  final List<TopProduct> topProducts;
  final List<DepartmentSummary> byDepartment;
  final List<DaySummary> byDay;

  SalesReport({
    required this.summary,
    required this.payments,
    required this.cashiers,
    required this.topProducts,
    required this.byDepartment,
    required this.byDay,
  });

  factory SalesReport.fromJson(Map<String, dynamic> json) {
    return SalesReport(
      summary: SalesSummary.fromJson(json['summary']),
      payments: (json['payments'] as List? ?? []).map((e) => PaymentBreakdown.fromJson(e)).toList(),
      cashiers: (json['cashiers'] as List? ?? []).map((e) => CashierSummary.fromJson(e)).toList(),
      topProducts: (json['top_products'] as List? ?? []).map((e) => TopProduct.fromJson(e)).toList(),
      byDepartment: (json['by_department'] as List? ?? []).map((e) => DepartmentSummary.fromJson(e)).toList(),
      byDay: (json['by_day'] as List? ?? []).map((e) => DaySummary.fromJson(e)).toList(),
    );
  }
}

class Product {
  final int id;
  final String name;
  final String barcode;
  final int? categoryId;
  final String? categoryName;
  final int? categoryColor;
  final double price;
  final double cost;
  final double? stock;
  final double? effectiveStock;
  final bool hasLots;

  Product({
    required this.id,
    required this.name,
    required this.barcode,
    this.categoryId,
    this.categoryName,
    this.categoryColor,
    required this.price,
    required this.cost,
    this.stock,
    this.effectiveStock,
    this.hasLots = false,
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] as int,
      name: json['name'] as String,
      barcode: json['barcode'] as String? ?? '',
      categoryId: json['category_id'] as int?,
      categoryName: json['category_name'] as String?,
      categoryColor: json['category_color'] as int?,
      price: (json['price'] as num?)?.toDouble() ?? 0,
      cost: (json['cost'] as num?)?.toDouble() ?? 0,
      stock: (json['stock'] as num?)?.toDouble(),
      effectiveStock: (json['effective_stock'] as num?)?.toDouble(),
      hasLots: json['has_lots'] == true,
    );
  }
}