import csv
import io
import os
import pytesseract
from PIL import Image
import re
from datetime import datetime
pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)


from django.contrib import messages
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import HttpResponseNotAllowed
from django.shortcuts import get_object_or_404, render, redirect

from .models import Transaction


REQUIRED_CSV_COLUMNS = {
    'date',
    'merchant',
    'amount',
    'payment_method',
    'category',
}
OPTIONAL_CSV_COLUMNS = {'description'}
EXPECTED_CSV_COLUMNS = REQUIRED_CSV_COLUMNS | OPTIONAL_CSV_COLUMNS



ALLOWED_RECEIPT_EXTENSIONS = {'jpg', 'jpeg', 'png', 'pdf'}


RECEIPT_MAGIC_SIGNATURES = {
    'jpg': (b'\xff\xd8\xff',),
    'jpeg': (b'\xff\xd8\xff',),
    'png': (b'\x89PNG\r\n\x1a\n',),
    'pdf': (b'%PDF',),
}


RECEIPT_SIGNATURE_BYTES = 16




def decode_csv_content(file_bytes):
    """Decode CSV bytes without replacing malformed characters."""
    if b'\x00' in file_bytes:
        raise UnicodeDecodeError(
            'csv', file_bytes, file_bytes.index(b'\x00'), file_bytes.index(b'\x00') + 1,
            'NUL bytes are not valid in a text CSV file',
        )

    for encoding in ('utf-8-sig', 'utf-8', 'cp1252'):
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue

    raise UnicodeDecodeError(
        'csv', file_bytes, 0, len(file_bytes),
        'file is not valid UTF-8 or Windows-1252 text',
    )


def import_csv_error(request, error):
    return render(request, 'expenses/import_csv.html', {'error': error})



def transactions(request):
    transactions = Transaction.objects.all().order_by('-date')
    return render(request, 'expenses/transactions.html', {
        'transactions' : transactions
    })

def add_expense(request):
    if request.method == 'POST':
        Transaction.objects.create(
            date = request.POST['date'],
            merchant = request.POST['merchant'],
            amount = request.POST['amount'],
            payment_method=request.POST['payment_method'],
            category=request.POST['category'],
            description=request.POST.get('description', ''),
            source='MANUAL'
        )

        return redirect('transactions')

    return render(request, 'expenses/add_expense.html')

def edit_expense(request, id):
    transaction = Transaction.objects.get(id=id)

    if request.method == 'POST':
        transaction.date = request.POST['date']
        transaction.merchant = request.POST['merchant']
        transaction.amount = request.POST['amount']
        transaction.payment_method = request.POST['payment_method']
        transaction.category = request.POST['category']
        transaction.description = request.POST.get('description', '')

        transaction.save()

        return redirect('transactions')

    return render(request, 'expenses/edit_expense.html', {
        'transaction': transaction
    })

def delete_expense(request, id):
    if request.method != 'POST':
        return HttpResponseNotAllowed(['POST'])

    transaction = get_object_or_404(Transaction, id=id)
    transaction.delete()
    return redirect('transactions')

def import_csv(request):
    if request.method == 'POST':
        csv_file = request.FILES.get('csv_file')

        if not csv_file or not csv_file.name.endswith('.csv'):
            return import_csv_error(request, 'Please upload a valid CSV file.')

        file_bytes = csv_file.read()
        try:
            decoded_file = decode_csv_content(file_bytes)
        except UnicodeDecodeError:
            return import_csv_error(
                request,
                (
                    'We could not read this CSV file. Please save it as UTF-8 or '
                    'Windows-1252 encoded CSV text and try again.'
                ),
            )

        csv_lines = decoded_file.splitlines(keepends=True)
        while csv_lines and not csv_lines[0].strip():
            csv_lines.pop(0)

        if not csv_lines:
            return import_csv_error(request, 'The CSV file must include a header row.')

        reader = csv.DictReader(io.StringIO(''.join(csv_lines), newline=''))
        fieldnames = reader.fieldnames
        if not fieldnames:
            return import_csv_error(request, 'The CSV file must include a header row.')

        actual_columns = set(fieldnames)
        missing_columns = REQUIRED_CSV_COLUMNS - actual_columns
        unexpected_columns = actual_columns - EXPECTED_CSV_COLUMNS
        duplicate_columns = len(fieldnames) != len(actual_columns)
        if missing_columns or unexpected_columns or duplicate_columns:
            return import_csv_error(
                request,
                (
                    'CSV columns do not match the expected columns. Required columns: '
                    'date, merchant, amount, payment_method, category. Optional column: '
                    'description.'
                ),
            )

        transactions_to_create = []
        seen_transactions = set()
        try:
            for row_number, row in enumerate(reader, start=2):
                if None in row or any(value is None for value in row.values()):
                    return import_csv_error(
                        request,
                        f'Row {row_number} has a different number of values than the header row.',
                    )

                transaction_to_create = Transaction(
                    date=row['date'],
                    merchant=row['merchant'],
                    amount=row['amount'],
                    payment_method=row['payment_method'],
                    category=row['category'],
                    description=row.get('description', ''),
                    source='CSV'
                )
                transaction_to_create.full_clean()

                duplicate_key = (
                    transaction_to_create.date,
                    transaction_to_create.merchant.strip().casefold(),
                    transaction_to_create.amount,
                    transaction_to_create.payment_method,
                )

                if duplicate_key in seen_transactions or Transaction.objects.filter(
                     date=transaction_to_create.date,
                     merchant__iexact=transaction_to_create.merchant.strip(),
                     amount=transaction_to_create.amount,
                     payment_method=transaction_to_create.payment_method,
                     ).exists():
                        continue

                seen_transactions.add(duplicate_key)
                transactions_to_create.append(transaction_to_create)
        except csv.Error:
            return import_csv_error(request, 'The CSV file is malformed and could not be parsed.')
        except ValidationError:
            return import_csv_error(
                request,
                f'Row {row_number} contains invalid transaction data. No transactions were imported.',
            )

        with transaction.atomic():
            for transaction_to_create in transactions_to_create:
                transaction_to_create.save()

        imported_count = len(transactions_to_create)
        if imported_count:
            messages.success(
                request,
                f'Successfully imported {imported_count} CSV transaction(s).'
                'Existing or repeated transactions were skipped.',
            )
        else:
            messages.info(request, 'No transaction rows were found in the CSV file.')

        return redirect('transactions')

    return render(request, 'expenses/import_csv.html')

def upload_receipt_error(request, error):
    return render(request, 'expenses/upload_receipt.html', {'error': error})


def get_receipt_extension(filename):
    """Return the lower-cased extension without the dot, or '' if there is none."""
    return os.path.splitext(filename or '')[1].lower().lstrip('.')


def receipt_matches_signature(extension, header_bytes):
    """Confirm the file's leading bytes match a known signature for its extension."""
    signatures = RECEIPT_MAGIC_SIGNATURES.get(extension, ())
    return any(header_bytes.startswith(signature) for signature in signatures)




def upload_receipt(request):
    if request.method != 'POST':
        return render(request, 'expenses/upload_receipt.html')

    receipt_file = request.FILES.get('receipt_file')

    if not receipt_file or receipt_file.size == 0:
        return upload_receipt_error(
            request,
            'Please choose a receipt file to upload.'
        )

    extension = get_receipt_extension(receipt_file.name)

    if extension not in ALLOWED_RECEIPT_EXTENSIONS:
        return upload_receipt_error(
            request,
            'Please upload a JPG, JPEG, PNG, or PDF receipt.'
        )

    # Verify the actual file type.
    header_bytes = receipt_file.read(RECEIPT_SIGNATURE_BYTES)
    receipt_file.seek(0)

    if not receipt_matches_signature(extension, header_bytes):
        return upload_receipt_error(
            request,
            'The file contents do not match the selected file type.'
        )

    if extension == 'pdf':
        return upload_receipt_error(
            request,
            'PDF OCR is not supported yet. Please upload a JPG or PNG image.'
        )

    try:
        from PIL import Image, ImageOps
        import pytesseract
        import re
        from datetime import datetime

        receipt_image = Image.open(receipt_file)
        receipt_image = ImageOps.exif_transpose(receipt_image).convert('RGB')

        # Enlarge the image to help OCR read small receipt text.
        width, height = receipt_image.size
        receipt_image = receipt_image.resize((width * 2, height * 2))

        extracted_text = pytesseract.image_to_string(
            receipt_image,
            lang='eng',
            config='--psm 6'
        )

    except Exception:
        return upload_receipt_error(
            request,
            'Could not read this image. Please try a clearer JPG or PNG receipt.'
        )

    lines = [
        line.strip()
        for line in extracted_text.splitlines()
        if line.strip()
    ]

    
    extracted_merchant = lines[0].lstrip('= ').strip() if lines else ''

    
    extracted_date = ''
    date_match = re.search(
        r'\b(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})\b',
        extracted_text
    )

    if date_match:
        raw_date = date_match.group(1)

        for date_format in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
            try:
                extracted_date = datetime.strptime(
                    raw_date, date_format
                ).strftime('%Y-%m-%d')
                break
            except ValueError:
                continue

    
    extracted_amount = ''

    for line in lines:
        if re.search(r'\bsubtotal\b', line, re.IGNORECASE):
            continue

        if re.search(r'\btotal\b', line, re.IGNORECASE):
            amount_match = re.search(
                r'(\d[\d,]*\s*[.,]\s*\d{2})',
                line
            )

            if amount_match:
                extracted_amount = re.sub(
                    r'[\s,]',
                    '',
                    amount_match.group(1)
                ).replace(',', '.')

                break

    
    payment_text = extracted_text.upper()

    if re.search(r'\bUPI\b', payment_text):
        extracted_payment_method = 'UPI'
    elif 'CREDIT CARD' in payment_text:
        extracted_payment_method = 'CREDIT_CARD'
    elif 'DEBIT CARD' in payment_text:
        extracted_payment_method = 'DEBIT_CARD'
    elif re.search(r'\bCASH\b', payment_text):
        extracted_payment_method = 'CASH'
    elif 'BANK TRANSFER' in payment_text:
        extracted_payment_method = 'BANK_TRANSFER'
    else:
        extracted_payment_method = 'OTHER'

    return render(
        request,
        'expenses/upload_receipt.html',
        {
            'uploaded_filename': receipt_file.name,
            'extracted_text': extracted_text,
            'extracted_merchant': extracted_merchant,
            'extracted_date': extracted_date,
            'extracted_amount': extracted_amount,
            'extracted_payment_method': extracted_payment_method,
        }
    )

def review_receipt(request):
    if request.method != 'POST':
        return redirect('upload_receipt')

    merchant = request.POST.get('merchant', '').strip()
    date = request.POST.get('date', '').strip()
    amount = request.POST.get('amount', '').strip()
    payment_method = request.POST.get('payment_method', '').strip()
    category = request.POST.get('category', '').strip()
    description = request.POST.get('description', '').strip()

    try:
        receipt_transaction = Transaction(
            merchant=merchant,
            date=date,
            amount=amount,
            payment_method=payment_method,
            category=category,
            description=description,
            source='BILL_SCAN',
        )

        receipt_transaction.full_clean()
        receipt_transaction.save()

    except ValidationError:
        return render(
            request,
            'expenses/upload_receipt.html',
            {
                'error': (
                    'Some receipt details are invalid. '
                    'Please check the fields and try again.'
                ),
            },
        )

    messages.success(
        request,
        f'Successfully saved receipt expense: {receipt_transaction.merchant}.',
    )
    return redirect('transactions')
