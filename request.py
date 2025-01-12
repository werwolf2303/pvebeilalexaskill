import requests
import pickle
import sys
import os


def save_cookies(requests_cookiejar, filename):
    with open(filename, 'wb') as f:
        pickle.dump(requests_cookiejar, f)


def load_cookies(filename):
    with open(filename, 'rb') as f:
        return pickle.load(f)


def main(target_url):
    with open(".queryString") as f:
        login_url = "https://api.solaredge.com/solaredge-apigw/api/login" + f.read()
    cookie_file = ".solaredge_cookies.txt"
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-A528B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36"})
    try:
        if os.path.exists(cookie_file):
            session.cookies.update(load_cookies(cookie_file))
            response = session.get("https://api.solaredge.com/solaredge-apigw/api/user/details")
            response.raise_for_status()
        else:
            response = session.post(login_url)
            response.raise_for_status()
            save_cookies(session.cookies, cookie_file)
    except requests.exceptions.RequestException as e:
        response = session.post(login_url)
        response.raise_for_status()
        save_cookies(session.cookies, cookie_file)
        session.cookies.update(load_cookies(cookie_file))

    response = session.get(target_url)
    response.raise_for_status()
    print(response.text)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python script.py <target_url>")
        sys.exit(1)
    target_url = sys.argv[1]
    main(target_url)