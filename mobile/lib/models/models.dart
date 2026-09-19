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
  final String? categoryColor;
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
      categoryColor: json['category_color'] as String?,
      price: (json['price'] as num?)?.toDouble() ?? 0,
      cost: (json['cost'] as num?)?.toDouble() ?? 0,
      stock: (json['stock'] as num?)?.toDouble(),
      effectiveStock: (json['effective_stock'] as num?)?.toDouble(),
      hasLots: json['has_lots'] == true,
    );
  }
}

class Sale {
  final int id;
  final String saleDate;
  final double subtotal;
  final double tax;
  final double total;
  final String paymentMethod;
  final int? cashierId;
  final String cashierName;
  final String status;
  final double amountTendered;
  final double changeGiven;
  final String? customerName;
  final String? notes;
  final int itemCount;
  final double returnedAmount;

  Sale({
    required this.id,
    required this.saleDate,
    required this.subtotal,
    required this.tax,
    required this.total,
    required this.paymentMethod,
    this.cashierId,
    required this.cashierName,
    required this.status,
    required this.amountTendered,
    required this.changeGiven,
    this.customerName,
    this.notes,
    required this.itemCount,
    required this.returnedAmount,
  });

  factory Sale.fromJson(Map<String, dynamic> json) {
    return Sale(
      id: json['id'] as int,
      saleDate: json['sale_date'] as String? ?? '',
      subtotal: (json['subtotal'] as num?)?.toDouble() ?? 0,
      tax: (json['tax'] as num?)?.toDouble() ?? 0,
      total: (json['total'] as num?)?.toDouble() ?? 0,
      paymentMethod: json['payment_method'] as String? ?? 'cash',
      cashierId: json['cashier_id'] as int?,
      cashierName: json['cashier_name'] as String? ?? '',
      status: json['status'] as String? ?? 'active',
      amountTendered: (json['amount_tendered'] as num?)?.toDouble() ?? 0,
      changeGiven: (json['change_given'] as num?)?.toDouble() ?? 0,
      customerName: json['customer_name'] as String?,
      notes: json['notes'] as String?,
      itemCount: (json['item_count'] as num?)?.toInt() ?? 0,
      returnedAmount: (json['returned_amount'] as num?)?.toDouble() ?? 0,
    );
  }
}

class SaleItem {
  final int id;
  final int? productId;
  final int? lotId;
  final double quantity;
  final double unitPrice;
  final double total;
  final double discount;
  final double returnedQuantity;
  final double returnedAmount;
  final String productName;
  final String? barcode;
  final String? batchNumber;
  final String? expiryDate;

  SaleItem({
    required this.id,
    this.productId,
    this.lotId,
    required this.quantity,
    required this.unitPrice,
    required this.total,
    required this.discount,
    required this.returnedQuantity,
    required this.returnedAmount,
    required this.productName,
    this.barcode,
    this.batchNumber,
    this.expiryDate,
  });

  factory SaleItem.fromJson(Map<String, dynamic> json) {
    return SaleItem(
      id: json['id'] as int,
      productId: json['product_id'] as int?,
      lotId: json['lot_id'] as int?,
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0,
      unitPrice: (json['unit_price'] as num?)?.toDouble() ?? 0,
      total: (json['total'] as num?)?.toDouble() ?? 0,
      discount: (json['discount'] as num?)?.toDouble() ?? 0,
      returnedQuantity: (json['returned_quantity'] as num?)?.toDouble() ?? 0,
      returnedAmount: (json['returned_amount'] as num?)?.toDouble() ?? 0,
      productName: json['product_name'] as String? ?? '',
      barcode: json['barcode'] as String?,
      batchNumber: json['batch_number'] as String?,
      expiryDate: json['expiry_date'] as String?,
    );
  }
}

class SaleDetail {
  final Sale sale;
  final List<SaleItem> items;

  SaleDetail({required this.sale, required this.items});

  factory SaleDetail.fromJson(Map<String, dynamic> json) {
    return SaleDetail(
      sale: Sale.fromJson(json),
      items: (json['items'] as List? ?? [])
          .map((e) => SaleItem.fromJson(e))
          .toList(),
    );
  }
}

class AdjustmentProduct {
  final int id;
  final String name;
  final String barcode;
  final String? categoryName;
  final String? categoryColor;
  final double price;
  final double cost;
  final double productStock;
  final double effectiveStock;
  final double lotsTotal;
  final bool hasLots;
  final List<AdjustmentLot> lots;

  AdjustmentProduct({
    required this.id,
    required this.name,
    required this.barcode,
    this.categoryName,
    this.categoryColor,
    required this.price,
    required this.cost,
    required this.productStock,
    required this.effectiveStock,
    required this.lotsTotal,
    required this.hasLots,
    required this.lots,
  });

  factory AdjustmentProduct.fromJson(Map<String, dynamic> json) {
    return AdjustmentProduct(
      id: json['id'] as int,
      name: json['name'] as String,
      barcode: json['barcode'] as String? ?? '',
      categoryName: json['category_name'] as String?,
      categoryColor: json['category_color'] as String?,
      price: (json['price'] as num?)?.toDouble() ?? 0,
      cost: (json['cost'] as num?)?.toDouble() ?? 0,
      productStock: (json['product_stock'] as num?)?.toDouble() ?? 0,
      effectiveStock: (json['effective_stock'] as num?)?.toDouble() ?? 0,
      lotsTotal: (json['lots_total'] as num?)?.toDouble() ?? 0,
      hasLots: json['has_lots'] == true,
      lots: (json['lots'] as List? ?? [])
          .map((e) => AdjustmentLot.fromJson(e))
          .toList(),
    );
  }
}

class AdjustmentLot {
  final int id;
  final String batchNumber;
  final double currentQuantity;
  final String? expiryDate;
  final double? salePrice;
  final bool isExpired;
  final int? daysLeft;

  AdjustmentLot({
    required this.id,
    required this.batchNumber,
    required this.currentQuantity,
    this.expiryDate,
    this.salePrice,
    required this.isExpired,
    this.daysLeft,
  });

  factory AdjustmentLot.fromJson(Map<String, dynamic> json) {
    return AdjustmentLot(
      id: json['id'] as int,
      batchNumber: json['batch_number'] as String? ?? '',
      currentQuantity: (json['current_quantity'] as num?)?.toDouble() ?? 0,
      expiryDate: json['expiry_date'] as String?,
      salePrice: (json['sale_price'] as num?)?.toDouble(),
      isExpired: json['is_expired'] == true,
      daysLeft: json['days_left'] as int?,
    );
  }
}