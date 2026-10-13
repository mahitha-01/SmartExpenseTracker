from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase
from django.urls import reverse

from .models import Transaction


# Real "magic byte" signatures so tests exercise the same content check as the view.
PNG_BYTES = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32
JPG_BYTES = b'\xff\xd8\xff\xe0' + b'\x00' * 32
PDF_BYTES = b'%PDF-1.4\n' + b'%' * 32



class TransactionActionsTests(TestCase):
    def setUp(self):
        self.transaction = Transaction.objects.create(
            date='2026-10-01',
            merchant='Corner Coffee',
            amount='125.50',
            payment_method='UPI',
            category='FOOD',
        )

    def test_dashboard_includes_edit_and_delete_actions(self):
        response = self.client.get(reverse('transactions'))

        self.assertContains(response, reverse('edit_expense', args=[self.transaction.id]))
        self.assertContains(response, reverse('delete_expense', args=[self.transaction.id]))
        self.assertContains(response, reverse('import_csv'))
        self.assertContains(response, 'Import Expenses')
        self.assertContains(response, 'csrfmiddlewaretoken')
        self.assertContains(response, 'Actions')

    def test_delete_requires_post(self):
        response = self.client.get(reverse('delete_expense', args=[self.transaction.id]))

        self.assertEqual(response.status_code, 405)
        self.assertTrue(Transaction.objects.filter(id=self.transaction.id).exists())

    def test_post_delete_removes_transaction_and_returns_to_dashboard(self):
        response = self.client.post(reverse('delete_expense', args=[self.transaction.id]))

        self.assertRedirects(response, reverse('transactions'))
        self.assertFalse(Transaction.objects.filter(id=self.transaction.id).exists())

    def test_delete_rejects_post_without_csrf_token(self):
        csrf_client = Client(enforce_csrf_checks=True)
        response = csrf_client.post(reverse('delete_expense', args=[self.transaction.id]))

        self.assertEqual(response.status_code, 403)
        self.assertTrue(Transaction.objects.filter(id=self.transaction.id).exists())


class ImportCsvTests(TestCase):
    csv_headers = (
        'date,merchant,amount,payment_method,category,description\n'
    )

    def upload_csv(self, content):
        csv_file = SimpleUploadedFile(
            'expenses.csv',
            content,
            content_type='text/csv',
        )
        return self.client.post(reverse('import_csv'), {'csv_file': csv_file})

    def test_import_page_contains_the_csv_upload_form(self):
        response = self.client.get(reverse('import_csv'))

        self.assertContains(response, 'Import Expenses')
        self.assertContains(response, 'name="csv_file"', html=False)
        self.assertContains(response, 'accept=".csv,text/csv"', html=False)
        self.assertContains(response, 'Import CSV')
        self.assertContains(response, 'Back to Dashboard')

    def test_imports_utf8_bom_csv(self):
        content = (
            '\ufeff'
            f'{self.csv_headers}'
            '2026-10-02,Cafe,10.25,CASH,FOOD,Breakfast\n'
        ).encode('utf-8')

        response = self.upload_csv(content)

        self.assertRedirects(response, reverse('transactions'))
        transaction = Transaction.objects.get()
        self.assertEqual(transaction.merchant, 'Cafe')
        self.assertEqual(transaction.source, 'CSV')

    def test_imports_sample_csv_with_a_leading_blank_line(self):
        sample_csv_path = Path(__file__).resolve().parent / 'sample_expenses.csv'
        csv_file = SimpleUploadedFile(
            'sample_expenses.csv',
            sample_csv_path.read_bytes(),
            content_type='text/csv',
        )

        response = self.client.post(
            reverse('import_csv'),
            {'csv_file': csv_file},
            follow=True,
        )

        self.assertEqual(response.redirect_chain, [(reverse('transactions'), 302)])
        self.assertEqual(Transaction.objects.filter(source='CSV').count(), 4)
        self.assertSetEqual(
            set(Transaction.objects.values_list('merchant', flat=True)),
            {'Swiggy', 'DMart', 'Amazon', 'Metro'},
        )
        self.assertContains(
            response,
            'Successfully imported 4 CSV transaction(s).',
        )

    def test_imports_windows_1252_csv(self):
        content = (
            f'{self.csv_headers}'
            '2026-10-03,Caf\xe9,11.50,CASH,FOOD,Cr\xe8me br\xfbl\xe9e\n'
        ).encode('cp1252')

        response = self.upload_csv(content)

        self.assertRedirects(response, reverse('transactions'))
        transaction = Transaction.objects.get()
        self.assertEqual(transaction.merchant, 'Café')
        self.assertEqual(transaction.description, 'Crème brûlée')

    def test_skips_duplicate_transactions_on_a_second_import(self):
        content = (
            f'{self.csv_headers}'
            '2026-10-03,Cafe,10.25,CASH,FOOD,Breakfast\n'
        ).encode('utf-8')

        self.assertRedirects(self.upload_csv(content), reverse('transactions'))
        response = self.upload_csv(content)

        self.assertRedirects(response, reverse('transactions'))
        self.assertEqual(Transaction.objects.filter(source='CSV').count(), 1)

    def test_rejects_unsupported_encoding_without_importing_transactions(self):
        content = (
            self.csv_headers.encode('ascii') +
            b'2026-10-04,Bad\x81Text,12.00,CASH,FOOD,Invalid encoding\n'
        )

        response = self.upload_csv(content)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'We could not read this CSV file.')
        self.assertEqual(Transaction.objects.count(), 0)

    def test_rejects_unexpected_csv_columns_without_importing_transactions(self):
        content = (
            'date,merchant,amount,payment_method,category,notes\n'
            '2026-10-04,Market,12.00,CASH,FOOD,Extra column\n'
        ).encode('utf-8')

        response = self.upload_csv(content)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'CSV columns do not match the expected columns.')
        self.assertEqual(Transaction.objects.count(), 0)

    def test_rejects_all_rows_when_one_row_is_invalid(self):
        content = (
            f'{self.csv_headers}'
            '2026-10-04,Market,12.00,CASH,FOOD,Valid row\n'
            'not-a-date,Invalid,13.00,CASH,FOOD,Invalid row\n'
        ).encode('utf-8')

        response = self.upload_csv(content)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Row 3 contains invalid transaction data.')
        self.assertEqual(Transaction.objects.count(), 0)

class UploadReceiptTests(TestCase):
    def upload_receipt(self, filename, content, content_type=None):
        receipt_file = SimpleUploadedFile(filename, content, content_type=content_type)
        return self.client.post(reverse('upload_receipt'), {'receipt_file': receipt_file})

    def test_upload_page_contains_the_receipt_upload_form(self):
        response = self.client.get(reverse('upload_receipt'))

        self.assertContains(response, 'Upload Receipt')
        self.assertContains(response, 'name="receipt_file"', html=False)
        self.assertContains(response, 'accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"', html=False)
        self.assertContains(response, 'Back to Dashboard')

    def test_dashboard_links_to_the_upload_page(self):
        response = self.client.get(reverse('transactions'))

        self.assertContains(response, reverse('upload_receipt'))
        self.assertContains(response, 'Upload Receipt')

    def test_accepts_valid_png_and_shows_success_message(self):
        response = self.upload_receipt('receipt.png', PNG_BYTES, content_type='image/png')

        self.assertRedirects(response, reverse('upload_receipt'))
        # Follow the redirect to read the flashed success message.
        response = self.client.post(
            reverse('upload_receipt'),
            {'receipt_file': SimpleUploadedFile('receipt.png', PNG_BYTES, content_type='image/png')},
            follow=True,
        )
        self.assertContains(response, 'passed validation and is ready to process')

    def test_accepts_valid_jpg(self):
        response = self.upload_receipt('receipt.jpg', JPG_BYTES, content_type='image/jpeg')

        self.assertRedirects(response, reverse('upload_receipt'))
        self.assertEqual(Transaction.objects.count(), 0)

    def test_accepts_valid_pdf(self):
        response = self.upload_receipt('receipt.pdf', PDF_BYTES, content_type='application/pdf')

        self.assertRedirects(response, reverse('upload_receipt'))
        self.assertEqual(Transaction.objects.count(), 0)

    def test_rejects_missing_file(self):
        response = self.client.post(reverse('upload_receipt'), {})

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Please choose a receipt file to upload.')

    def test_rejects_empty_file(self):
        response = self.upload_receipt('receipt.png', b'', content_type='image/png')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Please choose a receipt file to upload.')

    def test_rejects_unsupported_extension(self):
        response = self.upload_receipt('notes.txt', b'just some text', content_type='text/plain')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Unsupported file type.')

    def test_rejects_content_that_does_not_match_extension(self):
        # A PNG name but plain-text content: the filename is not proof of safety.
        response = self.upload_receipt('fake.png', b'this is not a real image', content_type='image/png')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'does not look like a valid PNG')
        self.assertEqual(Transaction.objects.count(), 0)

