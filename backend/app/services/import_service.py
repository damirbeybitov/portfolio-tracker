import csv
import io
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import TransactionType
from app.schemas.portfolio import TransactionCreate, TransactionImportResult, TransactionImportRow
from app.services.portfolio_service import PortfolioService
from app.models.bank import BankTransactionType
from app.schemas.bank import BankTransactionCreate, BankTransactionImportResult, BankTransactionImportRow
from app.services.bank_service import BankService

logger = logging.getLogger("app.services.import")

REQUIRED_COLUMNS = {"ticker", "type", "date", "quantity", "price_usd"}
OPTIONAL_COLUMNS = {"fx_rate_usd_kzt", "split_ratio", "notes"}
DATE_FORMATS = ["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y"]
BANK_REQUIRED_COLUMNS = {"type", "date", "amount"}

# Portfolio transactions now only support BUY, SELL, SPLIT
ALLOWED_PORTFOLIO_TYPES = {TransactionType.BUY, TransactionType.SELL, TransactionType.SPLIT}


class ImportService:

    @staticmethod
    async def import_transactions(
        db: AsyncSession, user_id: int, portfolio_id: int, file_bytes: bytes, filename: str,
    ) -> TransactionImportResult:
        await PortfolioService.get_or_404(db, user_id, portfolio_id)
        rows = ImportService._parse_file(file_bytes, filename)

        results: list[TransactionImportRow] = []
        imported = 0
        failed = 0

        for idx, raw_row in enumerate(rows, start=2):
            try:
                tx_create = await ImportService._row_to_transaction(db, raw_row)
                tx_response = await PortfolioService.add_transaction(db, user_id, portfolio_id, tx_create)
                results.append(TransactionImportRow(row=idx, status="ok", transaction=tx_response))
                imported += 1
            except HTTPException as e:
                results.append(TransactionImportRow(row=idx, status="error", error=str(e.detail)))
                failed += 1
            except Exception as e:
                logger.warning("Import row %d failed: %s", idx, e)
                results.append(TransactionImportRow(row=idx, status="error", error=str(e)))
                failed += 1

        return TransactionImportResult(
            total=imported + failed,
            imported=imported,
            failed=failed,
            results=results,
        )

    # ── File parsing ──────────────────────────────────────────────────────────

    @staticmethod
    def _parse_file(
        file_bytes: bytes,
        filename: str,
        required: set[str] | None = None,
    ) -> list[dict]:
        lower = filename.lower()
        req = required or REQUIRED_COLUMNS
        if lower.endswith(".csv"):
            return ImportService._parse_csv(file_bytes, req)
        elif lower.endswith((".xlsx", ".xls")):
            return ImportService._parse_excel(file_bytes, req)
        else:
            raise HTTPException(status_code=422, detail="Unsupported file type. Use .csv or .xlsx")

    @staticmethod
    def _parse_csv(file_bytes: bytes, required: set[str]) -> list[dict]:
        try:
            text = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = file_bytes.decode("latin-1")

        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames is None:
            raise HTTPException(status_code=422, detail="CSV file is empty")

        normalized = {f.strip().lower(): f for f in reader.fieldnames}
        missing = required - set(normalized.keys())
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Missing required columns: {', '.join(sorted(missing))}",
            )

        rows = []
        for raw in reader:
            row = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in raw.items()}
            rows.append(row)
        return rows

    @staticmethod
    def _parse_excel(file_bytes: bytes, required: set[str]) -> list[dict]:
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(status_code=500, detail="Excel import requires 'openpyxl'.")

        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        ws = wb.active

        rows_iter = ws.iter_rows(values_only=True)
        try:
            header = next(rows_iter)
        except StopIteration:
            raise HTTPException(status_code=422, detail="Excel file is empty")

        header_norm = [str(h).strip().lower() if h is not None else "" for h in header]
        missing = required - set(header_norm)
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Missing required columns: {', '.join(sorted(missing))}",
            )

        rows = []
        for values in rows_iter:
            if all(v is None for v in values):
                continue
            row = {}
            for col_name, value in zip(header_norm, values):
                if not col_name:
                    continue
                if isinstance(value, str):
                    value = value.strip()
                row[col_name] = value
            rows.append(row)
        return rows

    # ── Row converters ────────────────────────────────────────────────────────

    @staticmethod
    async def _row_to_transaction(db: AsyncSession, row: dict) -> TransactionCreate:
        ticker = str(row.get("ticker", "")).strip().upper()
        if not ticker:
            raise ValueError("Missing 'ticker'")

        type_raw = str(row.get("type", "")).strip().upper()
        if type_raw not in TransactionType.__members__:
            raise ValueError(
                f"Invalid type '{type_raw}'. Must be one of: {', '.join(t.value for t in ALLOWED_PORTFOLIO_TYPES)}"
            )
        tx_type = TransactionType(type_raw)
        if tx_type not in ALLOWED_PORTFOLIO_TYPES:
            raise ValueError(
                f"Type '{type_raw}' is not allowed in portfolio imports. "
                f"Use BUY, SELL, or SPLIT. Dividends/taxes/commissions belong in bank transactions."
            )

        tx_date = ImportService._parse_date(row.get("date"))
        quantity = ImportService._parse_decimal(row.get("quantity"), default=Decimal("0"))
        price_usd = ImportService._parse_decimal(row.get("price_usd"), default=Decimal("0"))

        fx_rate_raw = row.get("fx_rate_usd_kzt")
        fx_rate = (
            ImportService._parse_decimal(fx_rate_raw, default=None)
            if fx_rate_raw not in (None, "")
            else None
        )

        split_raw = row.get("split_ratio")
        split_ratio = (
            ImportService._parse_decimal(split_raw, default=None)
            if split_raw not in (None, "")
            else None
        )

        notes = row.get("notes") or None
        security = await PortfolioService.get_or_create_security(db, ticker)

        return TransactionCreate(
            security_id=security.id,
            type=tx_type,
            date=tx_date,
            quantity=quantity,
            price_usd=price_usd,
            fx_rate_usd_kzt=fx_rate,
            split_ratio=split_ratio,
            notes=notes,
        )

    @staticmethod
    def _parse_date(value):
        if value is None:
            raise ValueError("Missing 'date'")
        if isinstance(value, datetime):
            return value.date()
        if hasattr(value, "isoformat") and not isinstance(value, str):
            return value

        s = str(value).strip()
        for fmt in DATE_FORMATS:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        raise ValueError(f"Unrecognized date format: '{s}'")

    @staticmethod
    def _parse_decimal(value, default=Decimal("0")):
        if value is None or value == "":
            return default
        try:
            return Decimal(str(value).replace(",", "").replace(" ", ""))
        except (InvalidOperation, ValueError):
            raise ValueError(f"Invalid number: '{value}'")

    # ── Bank transaction import ───────────────────────────────────────────────

    @staticmethod
    async def import_bank_transactions(
        db: AsyncSession, user_id: int, account_id: int, file_bytes: bytes, filename: str,
    ) -> BankTransactionImportResult:
        await BankService.get_account_or_404(db, user_id, account_id)
        rows = ImportService._parse_file(
            file_bytes, filename, required=BANK_REQUIRED_COLUMNS
        )

        results = []
        imported = failed = 0
        for idx, raw_row in enumerate(rows, start=2):
            try:
                tx_create = ImportService._row_to_bank_transaction(raw_row)
                tx_response = await BankService.add_transaction(db, user_id, account_id, tx_create)
                results.append(BankTransactionImportRow(row=idx, status="ok", transaction=tx_response))
                imported += 1
            except HTTPException as e:
                results.append(BankTransactionImportRow(row=idx, status="error", error=str(e.detail)))
                failed += 1
            except Exception as e:
                results.append(BankTransactionImportRow(row=idx, status="error", error=str(e)))
                failed += 1

        return BankTransactionImportResult(
            total=imported + failed,
            imported=imported,
            failed=failed,
            results=results,
        )

    @staticmethod
    def _row_to_bank_transaction(row: dict) -> BankTransactionCreate:
        type_raw = str(row.get("type", "")).strip().upper()
        if type_raw not in BankTransactionType.__members__:
            raise ValueError(f"Invalid type '{type_raw}'")
        tx_date = ImportService._parse_date(row.get("date"))
        amount = ImportService._parse_decimal(row.get("amount"), default=None)
        if amount is None:
            raise ValueError("Missing 'amount'")
        fx_rate_raw = row.get("fx_rate")
        fx_rate = (
            ImportService._parse_decimal(fx_rate_raw, default=None)
            if fx_rate_raw not in (None, "")
            else None
        )
        related_raw = row.get("related_account_id")
        related_id = int(related_raw) if related_raw not in (None, "") else None
        notes = row.get("notes") or None
        return BankTransactionCreate(
            type=BankTransactionType(type_raw),
            date=tx_date,
            amount=amount,
            related_account_id=related_id,
            fx_rate=fx_rate,
            notes=notes,
        )
