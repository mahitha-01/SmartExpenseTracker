from django.urls import path
from . import views

urlpatterns = [
    path('transactions/', views.transactions, name = 'transactions'),
    path('add-expense/', views.add_expense, name='add_expense'),
    path('edit-expense/<int:id>/', views.edit_expense, name='edit_expense'),
    path('delete-expense/<int:id>/',views.delete_expense, name='delete_expense'),
    path('import-csv/', views.import_csv, name='import_csv'),
    path('upload-receipt/', views.upload_receipt, name='upload_receipt'),
    path('review-receipt/', views.review_receipt, name='review_receipt'),
]