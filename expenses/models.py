from django.db import models

# Create your models here.
class Transaction(models.Model):
    PAYMENT_METHODS = [
        ('UPI','UPI'),
        ('CREDIT_CARD', 'Credit Card'),
        ('DEBIT_CARD', 'Debit Card'),
        ('BANK_TRANSFER', 'Bank Transfer'),
        ('CASH', 'Cash'),
        ('OTHER', 'Other'),
    ]

    CATEGORIES = [
        ('FOOD', 'Food'),
        ('GROCERIES', 'Groceries'),
        ('SHOPPING', 'Shopping'),
        ('TRAVEL', 'Travel'),
        ('EDUCATION', 'Education'),
        ('BILLS', 'Bills'),
        ('ENTERTAINMENT', 'Entertainment'),
        ('HEALTHCARE', 'Healthcare'),
        ('SUBSCRIPTIONS', 'Subscriptions'),
        ('OTHER', 'Other'),
    ]

    date = models.DateField()
    merchant = models.CharField(max_length = 200)
    amount = models.DecimalField(max_digits = 10, decimal_places = 2)
    payment_method = models.CharField(max_length = 20, choices = PAYMENT_METHODS)
    category = models.CharField(max_length = 20, choices = CATEGORIES)
    description = models.TextField(blank = True)

    source = models.CharField(
        max_length = 20,
        choices = [
            ('MANUAL', 'Manual'),
            ('BILL_SCAN', 'Bill Scan'),
            ('CSV', 'CSV Import'),
        ],
        default = 'MANUAL'
    )

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.merchant} - ₹{self.amount}"
