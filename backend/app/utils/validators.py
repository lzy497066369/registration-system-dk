"""格式校验：员工号（i+6 位数字）、邮箱、手机号。"""
import re

EMPLOYEE_NO_RE = re.compile(r"^i\d{6}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^1\d{10}$")

ACTIVITY_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,31}$")


def normalize_employee_no(raw: str) -> str:
    value = (raw or "").strip().lower()
    if not EMPLOYEE_NO_RE.match(value):
        raise ValueError("员工号须为 i + 6 位数字（如 i123456）")
    return value


def normalize_email(raw: str) -> str:
    value = (raw or "").strip().lower()
    if not EMAIL_RE.match(value):
        raise ValueError("邮箱格式不正确")
    return value
