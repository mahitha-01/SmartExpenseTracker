# SmartExpenseTracker 💸

A web-based expense tracking application built with Django and Python to help users record, organize, and analyze their spending. The application includes receipt OCR, CSV import, transaction management, and an interactive dashboard.

## ✨ Features

- **Expense Management:** Add, edit, and delete expense transactions.
- **Receipt OCR:** Upload receipt images and extract transaction details using Optical Character Recognition (OCR).
- **Review Before Saving:** Verify and correct extracted receipt details before saving them.
- **Dashboard Analytics:** View total spending, average spending, transaction counts, category breakdowns, and monthly trends.
- **Search and Filters:** Search transactions and filter them by category, payment method, source, and time range.
- **CSV Import:** Import expense records from CSV files.
- **CSV Export:** Export transaction data for further analysis.
- **Data Validation:** Validate uploaded files and transaction details.
- **Responsive Interface:** Use a dashboard with dark and light theme support.

## 🛠️ Tech Stack

- **Backend:** Python, Django
- **Frontend:** HTML, CSS, JavaScript
- **Database:** SQLite
- **OCR:** Tesseract OCR, pytesseract, Pillow
- **Version Control:** Git and GitHub

## 📂 Project Structure

```text
SmartExpenseTracker/
├── config/
│   ├── settings.py
│   ├── urls.py
│   └── ...
├── expenses/
│   ├── migrations/
│   ├── static/
│   │   └── expenses/
│   │       ├── css/
│   │       └── js/
│   ├── templates/
│   │   └── expenses/
│   ├── models.py
│   ├── views.py
│   ├── urls.py
│   └── tests.py
├── .gitignore
├── manage.py
└── README.md
```

## ⚙️ Getting Started

### Prerequisites

- Python 3.9 or later
- pip
- Git
- Tesseract OCR installed and configured for receipt image processing

### 1. Clone the repository

```bash
git clone https://github.com/mahitha-01/SmartExpenseTracker.git
cd SmartExpenseTracker
```

### 2. Create and activate a virtual environment

**Windows PowerShell:**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 3. Install dependencies

Install the Python packages used by the project:

```powershell
pip install django pytesseract Pillow
```

If you maintain a `requirements.txt` file, use this instead:

```powershell
pip install -r requirements.txt
```

### 4. Configure Tesseract OCR

Install Tesseract OCR for Windows and configure its executable path in the application if it is not automatically detected.

Example path:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Update the path in the Python configuration if Tesseract is installed elsewhere.

### 5. Apply database migrations

```powershell
python manage.py migrate
```

### 6. Start the development server

```powershell
python manage.py runserver
```

Open the local development URL displayed in your terminal, usually:

http://127.0.0.1:8000/

## 🧾 Receipt OCR Workflow

1. Upload a supported receipt image.
2. Extract text using Tesseract OCR.
3. Review the detected merchant, date, amount, and payment method.
4. Correct any inaccurate details.
5. Save the verified expense.
6. View the transaction in the dashboard.

OCR results may vary depending on receipt image quality and formatting. Always verify extracted details before saving.

## 📊 Dashboard

The dashboard provides an overview of spending, including transaction records, spending by category, monthly trends, and payment-method breakdowns.

_Add screenshots of your dashboard and receipt review page here._

Example:

```markdown
![Expense dashboard](screenshots/dashboard.png)

![Receipt OCR review](screenshots/receipt-review.png)
```

## 🎯 Project Goals

This project was developed to practice Django web development, database operations, file handling, OCR integration, data visualization, and interactive frontend development.

## 🔮 Future Improvements

- Improve OCR accuracy for different receipt formats.
- Add user authentication and personalized expense records.
- Add budget limits and spending alerts.
- Support PDF receipts.
- Add advanced spending reports and downloadable summaries.

  ### Configure Tesseract OCR

Install Tesseract OCR on your computer and ensure the executable path is configured correctly in the application.

For Windows, the default path may be:

`C:\Program Files\Tesseract-OCR\tesseract.exe`

If Tesseract is installed in a different location, update the path in the Python configuration accordingly.

## 👩‍💻 Author

**Mahitha Muskula**

- GitHub: [mahitha-01](https://github.com/mahitha-01)

## 📄 License

This project is currently available for personal learning and portfolio demonstration. Add an open-source license if you decide to distribute it under specific reuse terms.
